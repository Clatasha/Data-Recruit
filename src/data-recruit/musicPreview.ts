import { type MusicClip, musicGain, musicPosition, musicSpan } from "./music";

/** Sources use the audio clock; animation frames only correct seeks and gain. */
export class MusicPreview {
	private context: AudioContext | null = null;
	private sources = new Map<
		string,
		{ source: AudioBufferSourceNode; gain: GainNode; origin: number; time: number; clip: MusicClip }
	>();
	stop() {
		for (const item of this.sources.values()) {
			item.source.stop();
			item.source.disconnect();
			item.gain.disconnect();
		}
		this.sources.clear();
	}
	dispose() {
		this.stop();
		void this.context?.close();
		this.context = null;
	}
	sync(clips: MusicClip[], at: number, playing: boolean, previewVolume: number) {
		if (!playing) {
			this.stop();
			return;
		}
		if (!clips.length && !this.sources.size) return;
		this.context ??= new AudioContext();
		const context = this.context;
		if (context.state === "suspended")
			void context.resume().catch(() => {
				/* Retry when the next playback gesture resumes audio. */
			});
		for (const [id, active] of this.sources) {
			const clip = clips.find((item) => item.id === id);
			if (
				clip !== active.clip ||
				!clip ||
				musicPosition(clip, at - clip.at) === null ||
				Math.abs(at - (active.origin + context.currentTime - active.time)) > 0.2
			) {
				active.source.stop();
				active.source.disconnect();
				active.gain.disconnect();
				this.sources.delete(id);
			}
		}
		for (const clip of clips) {
			const local = at - clip.at,
				offset = musicPosition(clip, local);
			if (offset === null || clip.muted) continue;
			let active = this.sources.get(clip.id);
			if (!active) {
				const source = context.createBufferSource(),
					gain = context.createGain();
				source.buffer = clip.buffer;
				source.loop = clip.loop;
				source.loopStart = clip.start;
				source.loopEnd = clip.start + musicSpan(clip);
				source.connect(gain);
				gain.connect(context.destination);
				gain.gain.value = musicGain(clip, local) * previewVolume;
				source.start(0, offset, Math.max(0.001, clip.duration - local));
				active = { source, gain, origin: at, time: context.currentTime, clip };
				this.sources.set(clip.id, active);
			}
			active.gain.gain.setTargetAtTime(
				musicGain(clip, local) * previewVolume,
				context.currentTime,
				0.008,
			);
		}
	}
}
