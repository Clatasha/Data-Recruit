import {
	ALL_FORMATS,
	AudioSample,
	AudioSampleSource,
	BufferSource,
	BufferTarget,
	CanvasSink,
	CanvasSource,
	canEncodeAudio,
	canEncodeVideo,
	Input,
	Mp4OutputFormat,
	Output,
} from "mediabunny";
import type { Bookend } from "./bookends";
import { DEFAULT_EXPORT, type ExportSettings, exportGeometry } from "./exportSettings";
import { geometry, type ScrollSettings, scrollDuration } from "./model";
import { drawImageFit, drawScroll } from "./render";

interface VideoBookend {
	item: Extract<Bookend, { kind: "video" }>;
	offset: number;
	input: Input;
	frames: AsyncGenerator<import("mediabunny").WrappedCanvas | null, void, unknown>;
	audio: AudioBuffer | null;
}

/** Decode bookend frames sequentially; export never seeks or plays the preview video. */
async function prepareVideo(
	item: Extract<Bookend, { kind: "video" }>,
	offset: number,
	width: number,
	height: number,
	fps: number,
): Promise<VideoBookend> {
	const bytes = await (await fetch(item.url)).arrayBuffer();
	const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error(`No video track in ${item.name}.`);
		const first = await track.getFirstTimestamp();
		const sink = new CanvasSink(track, { width, height, fit: "contain", poolSize: 2 });
		function* timestamps() {
			for (
				let frame = Math.ceil(offset * fps);
				frame < Math.ceil((offset + item.duration) * fps);
				frame++
			)
				yield first + Math.max(0, frame / fps - offset + (item.start ?? 0));
		}
		let audio: AudioBuffer | null = null;
		if (!item.muted && (await input.getPrimaryAudioTrack())) {
			const context = new OfflineAudioContext(2, 1, 48_000);
			try {
				audio = await context.decodeAudioData(bytes.slice(0));
			} catch {
				throw new Error(
					`Could not decode audio in ${item.name}. Convert it to AAC audio, or mute this bookend.`,
				);
			}
		}
		return { item, offset, input, frames: sink.canvasesAtTimestamps(timestamps()), audio };
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
): Promise<{ bytes: ArrayBuffer; hasAudio: boolean }> {
	const { width, height, bitrate } = exportGeometry(settings.format, options);
	const design = geometry(settings.format);
	const fps = options.fps;
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
	const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
	output.addVideoTrack(source, { frameRate: fps });
	const scroll = scrollDuration(cards.length, settings),
		introDuration = intro?.duration ?? 0;
	const total = introDuration + scroll + (outro?.duration ?? 0);
	const videos: VideoBookend[] = [];
	const checkCancelled = () => {
		if (signal.aborted) throw new Error("Export cancelled.");
	};
	try {
		if (intro?.kind === "video") videos.push(await prepareVideo(intro, 0, width, height, fps));
		if (outro?.kind === "video")
			videos.push(await prepareVideo(outro, introDuration + scroll, width, height, fps));
		checkCancelled();
		const hasAudio = videos.some((video) => video.audio);
		const audioOptions = { numberOfChannels: 2, sampleRate: 48_000, bitrate: 192_000 };
		const audioCodec = hasAudio
			? (await canEncodeAudio("aac", audioOptions))
				? "aac"
				: (await canEncodeAudio("opus", audioOptions))
					? "opus"
					: null
			: null;
		if (hasAudio && !audioCodec)
			throw new Error(
				"No audio encoder is available. Mute the intro/outro audio or use a browser with AAC or Opus encoding.",
			);
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
				const bookend =
					time < introDuration ? intro : time >= introDuration + scroll ? outro : null;
				if (bookend?.kind === "image") drawImageFit(ctx, bookend.media, 0, 0, width, height, "fit");
				else if (bookend?.kind === "video") {
					const video = videos.find((value) => value.item === bookend)!;
					const decoded = await video.frames.next();
					ctx.fillStyle = "#111827";
					ctx.fillRect(0, 0, width, height);
					if (decoded.value) ctx.drawImage(decoded.value.canvas, 0, 0, width, height);
					else if (!decoded.done) throw new Error(`No readable video frame in ${bookend.name}.`);
				} else {
					ctx.save();
					ctx.scale(width / design.width, height / design.height);
					drawScroll(ctx, cards, time - introDuration, settings);
					ctx.restore();
				}
				await source.add(time, Math.min(1 / fps, total - time));
				if (frame % 15 === 0) {
					progress(frame / frames);
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
							video.offset + video.audio.duration - (video.item.start ?? 0),
						);
					if (end <= start) continue;
					const from = Math.round((start - video.offset + (video.item.start ?? 0)) * 48_000),
						to = Math.round((end - video.offset + (video.item.start ?? 0)) * 48_000),
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
		progress(1);
		return { bytes: target.buffer, hasAudio: audioSource !== null };
	} catch (error) {
		await output.cancel().catch(() => {
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
