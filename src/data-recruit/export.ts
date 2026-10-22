import {
	AudioBufferSink,
	AudioSample,
	AudioSampleSource,
	BufferTarget,
	CanvasSource,
	canEncodeVideo,
	type Input,
	MovOutputFormat,
	Mp4OutputFormat,
	Output,
	VideoSample,
	VideoSampleSink,
} from "mediabunny";
import { selectAudioCodec } from "./audioEncoding";
import type { Bookend } from "./bookends";
import { DEFAULT_EXPORT, type ExportSettings, exportGeometry } from "./exportSettings";
import { copyAudioChunk, openBookendInput } from "./mediaSource";
import { geometry, type ScrollSettings } from "./model";
import { type MusicClip, mixMusic } from "./music";
import { drawImageFit } from "./render";
import { drawSequence } from "./sequence";
import { sequenceTiming } from "./transitions";
import { matchDecodedColor, previewColor } from "./videoColor";

interface VideoBookend {
	item: Extract<Bookend, { kind: "video" }>;
	offset: number;
	visibleStart: number;
	visibleEnd: number;
	input: Input;
	frames: AsyncGenerator<HTMLCanvasElement, void, unknown>;
	audio: AudioBuffer | null;
}

/** Decode bookend frames sequentially; export never seeks or plays the preview video. */
async function prepareVideo(
	item: Extract<Bookend, { kind: "video" }>,
	offset: number,
	fps: number,
	visibleStart: number,
	visibleEnd: number,
	signal: AbortSignal,
): Promise<VideoBookend> {
	const input = await openBookendInput(item.url);
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error(`No video track in ${item.name}.`);
		const first = await track.getFirstTimestamp();
		const color = item.colorSpace ?? previewColor(item.media);
		const sink = new VideoSampleSink(track);
		function* timestamps() {
			for (let frame = Math.ceil(visibleStart * fps); frame < Math.ceil(visibleEnd * fps); frame++)
				yield first +
					(item.start ?? 0) +
					Math.max(0, Math.min(item.duration - 1 / fps, frame / fps - offset));
		}
		async function* decodedFrames() {
			const pool = [document.createElement("canvas"), document.createElement("canvas")];
			let index = 0,
				reported = false;
			for await (const sample of sink.samplesAtTimestamps(timestamps())) {
				if (!sample) throw new Error(`No readable video frame in ${item.name}.`);
				const canvas = pool[index++ % pool.length];
				const frame = sample.toVideoFrame();
				let adjusted: VideoSample | null = null;
				try {
					if (!reported) {
						window.dispatchEvent(
							new CustomEvent("data-recruit:decoder-diagnostic", {
								detail: { native: color, decoded: frame.colorSpace.toJSON(), format: frame.format },
							}),
						);
						reported = true;
					}
					const corrected = await matchDecodedColor(frame, color);
					if (corrected) adjusted = new VideoSample(corrected, { rotation: sample.rotation });
					const draw = adjusted ?? sample;
					canvas.width = Math.round(draw.displayWidth);
					canvas.height = Math.round(draw.displayHeight);
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Canvas unavailable.");
					draw.drawWithFit(context, { fit: "fill" });
				} finally {
					adjusted?.close();
					frame.close();
					sample.close();
				}
				yield canvas;
			}
		}
		let audio: AudioBuffer | null = null;
		const audioTrack = !item.muted ? await input.getPrimaryAudioTrack() : null;
		if (audioTrack) {
			audio = new AudioBuffer({
				numberOfChannels: 2,
				length: Math.ceil(item.duration * 48_000),
				sampleRate: 48_000,
			});
			if (
				item.url.startsWith("data-recruit-media:") &&
				window.electronAPI?.dataRecruitBookendAudio
			) {
				const job = crypto.randomUUID();
				const abort = () => {
					void window.electronAPI?.dataRecruitCancelBookendAudio?.(job);
				};
				signal.throwIfAborted();
				signal.addEventListener("abort", abort, { once: true });
				try {
					const bytes = await window.electronAPI.dataRecruitBookendAudio(
						item.url.slice("data-recruit-media:".length),
						item.start ?? 0,
						item.duration,
						job,
					);
					signal.throwIfAborted();
					const pcm = new Float32Array(bytes);
					for (let channel = 0; channel < 2; channel++) {
						const output = audio.getChannelData(channel);
						for (let index = 0; index < Math.min(output.length, pcm.length / 2); index++)
							output[index] = pcm[index * 2 + channel];
					}
				} finally {
					signal.removeEventListener("abort", abort);
				}
			} else if (await audioTrack.canDecode()) {
				const sink = new AudioBufferSink(audioTrack),
					trimStart = first + (item.start ?? 0);
				for await (const chunk of sink.buffers(trimStart, trimStart + item.duration)) {
					if (signal.aborted) throw new Error("Export cancelled.");
					copyAudioChunk(audio, chunk.buffer, chunk.timestamp, trimStart);
				}
			} else {
				// Compatibility for older projects containing embedded video data.
				const context = new OfflineAudioContext(2, 1, 48_000);
				const decoded = await context.decodeAudioData(await (await fetch(item.url)).arrayBuffer());
				copyAudioChunk(audio, decoded, 0, item.start ?? 0);
			}
		}

		return {
			item,
			offset,
			visibleStart,
			visibleEnd,
			input,
			frames: decodedFrames(),
			audio,
		};
	} catch (error) {
		input.dispose();
		throw error;
	}
}

export async function encodeScroll(
	cards: HTMLCanvasElement[],
	settings: ScrollSettings,
	intro: Bookend | null,
	outro: Bookend | null,
	progress: (value: number) => void,
	signal: AbortSignal,
	options: ExportSettings = DEFAULT_EXPORT,
	music: MusicClip[] = [],
): Promise<{ bytes: ArrayBuffer; hasAudio: boolean; poster?: string }> {
	const { width, height, bitrate } = exportGeometry(settings.format, options);
	const design = geometry(settings.format);
	const fps = options.fps;
	let poster: string | undefined;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas unavailable");
	const ctx: CanvasRenderingContext2D = context;
	const software = await canEncodeVideo("avc", {
		width,
		height,
		bitrate,
		hardwareAcceleration: "prefer-software",
	});
	const source = new CanvasSource(canvas, {
		codec: "avc",
		bitrate,
		hardwareAcceleration: software ? "prefer-software" : "no-preference",
	});
	const target = new BufferTarget();
	let output: Output | undefined;
	const timing = sequenceTiming(cards.length, settings, intro, outro);
	const total = timing.total;
	const videos: VideoBookend[] = [];
	const checkCancelled = () => {
		if (signal.aborted) throw new Error("Export cancelled.");
	};
	try {
		if (intro?.kind === "video")
			videos.push(await prepareVideo(intro, 0, fps, 0, intro.duration + timing.introExit, signal));
		if (outro?.kind === "video")
			videos.push(
				await prepareVideo(outro, timing.outroHold, fps, timing.outroStart, total, signal),
			);
		checkCancelled();
		const hasAudio =
			videos.some((video) => video.audio) ||
			music.some((clip) => !clip.muted && clip.volume > 0 && clip.at < total);
		const audioCodec = hasAudio
			? await selectAudioCodec(Boolean(window.electronAPI?.dataRecruitEncodeAudio))
			: null;
		// QuickTime PCM is broadly readable by the bundled FFmpeg; the final file is MP4/AAC.
		output = new Output({
			format:
				audioCodec === "pcm-s16"
					? new MovOutputFormat({ fastStart: "in-memory" })
					: new Mp4OutputFormat({ fastStart: "in-memory" }),
			target,
		});
		output.addVideoTrack(source, { frameRate: fps });
		const audioSource = audioCodec
			? new AudioSampleSource({ codec: audioCodec, bitrate: 192_000 })
			: null;
		if (audioSource) output.addAudioTrack(audioSource);
		await output.start();
		async function renderFrames() {
			const frames = Math.ceil(total * fps);
			for (let frame = 0; frame < frames; frame++) {
				checkCancelled();
				const time = frame / fps;
				const videoFrames = new Map<Bookend, HTMLCanvasElement | OffscreenCanvas>();
				for (const video of videos) {
					if (time < video.visibleStart || time >= video.visibleEnd) continue;
					const decoded = await video.frames.next();
					if (decoded.value) videoFrames.set(video.item, decoded.value);
					else throw new Error(`No readable video frame in ${video.item.name}.`);
				}
				ctx.save();
				ctx.scale(width / design.width, height / design.height);
				drawSequence(ctx, cards, settings, time, intro, outro, (item) => {
					if (item.kind === "image")
						drawImageFit(ctx, item.media, 0, 0, design.width, design.height, "fit");
					else {
						ctx.fillStyle = "#111827";
						ctx.fillRect(0, 0, design.width, design.height);
						const videoFrame = videoFrames.get(item);
						if (videoFrame) drawImageFit(ctx, videoFrame, 0, 0, design.width, design.height, "fit");
					}
				});
				ctx.restore();
				if (frame === 0) poster = canvas.toDataURL("image/jpeg", 0.85);
				await source.add(time, Math.min(1 / fps, total - time));
				if (frame % 15 === 0) {
					progress((frame / frames) * (audioCodec === "pcm-s16" ? 0.95 : 1));
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
			}
			source.close();
		}
		async function renderAudio() {
			if (!audioSource) return;
			// Explicit silence between bookends keeps their audio at the right timeline positions.
			for (let second = 0; second < total; second++) {
				checkCancelled();
				const buffer = new AudioBuffer({
					numberOfChannels: 2,
					length: Math.round(Math.min(1, total - second) * 48_000),
					sampleRate: 48_000,
				});
				for (const video of videos) {
					if (!video.audio) continue;
					const start = Math.max(second, video.offset),
						end = Math.min(
							second + buffer.duration,
							video.offset + video.item.duration,
							video.offset + video.audio.duration,
						);
					if (end <= start) continue;
					const from = Math.round((start - video.offset) * 48_000),
						to = Math.round((end - video.offset) * 48_000),
						at = Math.round((start - second) * 48_000);
					for (let channel = 0; channel < 2; channel++)
						buffer.copyToChannel(
							video.audio
								.getChannelData(Math.min(channel, video.audio.numberOfChannels - 1))
								.subarray(from, to)
								.subarray(0, buffer.length - at)
								.map((value) => value * (video.item.volume ?? 1)),
							channel,
							at,
						);
				}
				mixMusic(buffer, second, music);
				for (const sample of AudioSample.fromAudioBuffer(buffer, second)) {
					try {
						await audioSource.add(sample);
					} finally {
						sample.close();
					}
				}
			}
			audioSource.close();
		}
		await Promise.all([renderFrames(), renderAudio()]);
		await output.finalize();
		if (!target.buffer) throw new Error("The video encoder did not return a file.");
		let bytes = target.buffer;
		if (audioCodec === "pcm-s16") {
			checkCancelled();
			const id = crypto.randomUUID();
			const cancel = () => {
				void window.electronAPI?.dataRecruitCancelAudio?.(id).catch(() => {
					/* Main may already have completed. */
				});
			};
			signal.addEventListener("abort", cancel, { once: true });
			try {
				bytes = await window.electronAPI!.dataRecruitEncodeAudio!(bytes, id);
			} finally {
				signal.removeEventListener("abort", cancel);
			}
			checkCancelled();
		}
		progress(1);
		return { bytes, hasAudio: audioSource !== null, poster };
	} catch (error) {
		await output?.cancel().catch(() => {
			/* Keep the original error. */
		});
		throw error;
	} finally {
		for (const video of videos) {
			video.input.dispose();
			await video.frames.return().catch(() => {
				/* Input disposal still frees decoders. */
			});
		}
	}
}
