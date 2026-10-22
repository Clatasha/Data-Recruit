import { z } from "zod";

export const musicSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string(),
	url: z
		.string()
		.regex(
			/^(?:data:audio\/|data-recruit-media:[a-f0-9-]{36}\.(?:mp3|wav|m4a|aac|ogg|flac|opus|webm|mp4)$)/i,
		),
	at: z.number().min(0).max(1200),
	start: z.number().min(0).max(1200),
	duration: z.number().min(0.1).max(1200),
	end: z.number().min(0.1).max(1200).optional(),
	volume: z.number().min(0).max(1),
	muted: z.boolean(),
	fadeIn: z.number().min(0).max(1200),
	fadeOut: z.number().min(0).max(1200),
	loop: z.boolean(),
	loopOffset: z.number().min(0).max(1200).default(0),
});
export type SavedMusic = z.infer<typeof musicSchema>;
export interface MusicClip extends SavedMusic {
	buffer: AudioBuffer;
	peaks: number[];
}
export function serializeMusic({ buffer: _buffer, peaks: _peaks, ...clip }: MusicClip): SavedMusic {
	return clip;
}
export function musicGain(clip: SavedMusic, local: number) {
	if (clip.muted || local < 0 || local >= clip.duration) return 0;
	return (
		clip.volume *
		Math.min(
			1,
			clip.fadeIn > 0 ? local / clip.fadeIn : 1,
			clip.fadeOut > 0 ? (clip.duration - local) / clip.fadeOut : 1,
		)
	);
}
export function musicSpan(clip: MusicClip) {
	return Math.max(0, Math.min(clip.buffer.duration, clip.end ?? clip.buffer.duration) - clip.start);
}
export function musicPosition(clip: MusicClip, local: number) {
	const span = musicSpan(clip);
	if (local < 0 || local >= clip.duration || span <= 0 || (!clip.loop && local >= span))
		return null;
	return clip.start + (clip.loop ? (local + clip.loopOffset) % span : local);
}
/** Add clips to the existing bookend mix. Preview volume is deliberately absent. */
export function mixMusic(target: AudioBuffer, at: number, clips: MusicClip[]) {
	for (const clip of clips) {
		if (
			clip.muted ||
			clip.volume === 0 ||
			at >= clip.at + clip.duration ||
			at + target.duration <= clip.at
		)
			continue;
		for (let channel = 0; channel < target.numberOfChannels; channel++) {
			const source = clip.buffer.getChannelData(
				Math.min(channel, clip.buffer.numberOfChannels - 1),
			);
			const output = target.getChannelData(channel);
			for (let index = 0; index < output.length; index++) {
				const local = at + index / target.sampleRate - clip.at;
				const pos = musicPosition(clip, local);
				if (pos === null) continue;
				const sample = pos * clip.buffer.sampleRate;
				const from = Math.min(source.length - 1, Math.floor(sample));
				const next = Math.min(source.length - 1, from + 1);
				output[index] +=
					(source[from] + (source[next] - source[from]) * (sample - from)) * musicGain(clip, local);
			}
		}
	}
}
export function waveform(buffer: AudioBuffer) {
	const samples = buffer.getChannelData(0);
	return Array.from({ length: 160 }, (_, bin) => {
		const from = Math.floor((bin * samples.length) / 160),
			end = Math.floor(((bin + 1) * samples.length) / 160);
		let peak = 0;
		for (let index = from; index < end; index += Math.max(1, Math.floor((end - from) / 200)))
			peak = Math.max(peak, Math.abs(samples[index]));
		return peak;
	});
}
export async function loadMusic(
	name: string,
	url: string,
	signal?: AbortSignal,
): Promise<MusicClip> {
	const managed = url.startsWith("data-recruit-media:");
	let buffer: AudioBuffer;
	if (
		managed &&
		window.electronAPI?.dataRecruitBookendAudio &&
		window.electronAPI.dataRecruitBookendInfo
	) {
		const id = url.slice("data-recruit-media:".length);
		const info = await window.electronAPI.dataRecruitBookendInfo(id);
		const media = new Audio();
		media.preload = "metadata";
		let duration: number;
		try {
			duration = await new Promise<number>((resolve, reject) => {
				const timer = setTimeout(() => done(new Error(`Timed out reading ${name}.`)), 20_000);
				function done(error?: Error) {
					clearTimeout(timer);
					media.onloadedmetadata = null;
					media.onerror = null;
					if (error) reject(error);
					else resolve(media.duration);
				}
				media.onloadedmetadata = () => done();
				media.onerror = () => done(new Error(`Cannot read audio in ${name}.`));
				media.src = info.url;
			});
		} finally {
			media.removeAttribute("src");
			media.load();
		}
		if (!Number.isFinite(duration) || duration < 0.1 || duration > 1200)
			throw new Error("Choose music between 0.1 seconds and 20 minutes long.");
		buffer = new AudioBuffer({
			numberOfChannels: 2,
			length: Math.ceil(duration * 48000),
			sampleRate: 48000,
		});
		for (let start = 0; start < duration; start += 600) {
			signal?.throwIfAborted();
			const job = crypto.randomUUID();
			const abort = () => {
				void window.electronAPI?.dataRecruitCancelBookendAudio?.(job);
			};
			signal?.addEventListener("abort", abort, { once: true });
			try {
				const bytes = await window.electronAPI.dataRecruitBookendAudio(
					id,
					start,
					Math.max(0.1, Math.min(600, duration - start)),
					job,
				);
				signal?.throwIfAborted();
				const pcm = new Float32Array(bytes),
					offset = Math.round(start * 48000);
				for (let channel = 0; channel < 2; channel++) {
					const output = buffer.getChannelData(channel);
					for (let index = 0; index < Math.min(pcm.length / 2, output.length - offset); index++)
						output[offset + index] = pcm[index * 2 + channel];
				}
			} finally {
				signal?.removeEventListener("abort", abort);
			}
		}
	} else {
		signal?.throwIfAborted();
		const context = new OfflineAudioContext(2, 1, 48000);
		buffer = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
		signal?.throwIfAborted();
		if (buffer.duration < 0.1 || buffer.duration > 1200)
			throw new Error("Choose music between 0.1 seconds and 20 minutes long.");
	}
	return {
		id: crypto.randomUUID(),
		name,
		url,
		buffer,
		peaks: waveform(buffer),
		at: 0,
		start: 0,
		duration: buffer.duration,
		end: buffer.duration,
		volume: 1,
		muted: false,
		fadeIn: 0,
		fadeOut: 0,
		loop: false,
		loopOffset: 0,
	};
}
/** Split without changing the persisted source or losing a loop's phase. */
export function splitMusic(clip: MusicClip, position: number): MusicClip[] | null {
	const local = position - clip.at;
	if (local < 0.1 || clip.duration - local < 0.1) return null;
	return [
		{ ...clip, duration: local, fadeIn: Math.min(clip.fadeIn, local), fadeOut: 0 },
		{
			...clip,
			id: crypto.randomUUID(),
			at: position,
			start: clip.loop ? clip.start : clip.start + local,
			loopOffset: clip.loop ? (clip.loopOffset + local) % musicSpan(clip) : 0,
			fadeIn: 0,
			fadeOut: Math.min(clip.fadeOut, clip.duration - local),
			duration: clip.duration - local,
		},
	];
}
