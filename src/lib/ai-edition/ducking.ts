import type { AxcutAudioTrack } from "./schema";
export const DEFAULT_DUCKING = {
	enabled: true,
	depthDb: -10,
	thresholdDbfs: -35,
	attackSec: 0.25,
	holdSec: 0.5,
	releaseSec: 0.6,
};
export type DuckingSettings = typeof DEFAULT_DUCKING;
export function trackDucking(
	track: Pick<AxcutAudioTrack, "kind" | "recordingSource" | "ducking">,
): DuckingSettings {
	return { ...DEFAULT_DUCKING, enabled: track.kind === "music", ...track.ducking };
}
export function advanceDuckDb(
	current: number,
	sinceVoice: number,
	elapsed: number,
	config: DuckingSettings,
) {
	if (!config.enabled) return 0;
	const from = Math.min(0, Math.max(config.depthDb, current));
	return sinceVoice <= config.holdSec
		? Math.max(config.depthDb, from + (config.depthDb / Math.max(0.01, config.attackSec)) * elapsed)
		: Math.min(0, from - (config.depthDb / Math.max(0.01, config.releaseSec)) * elapsed);
}

export const DEFAULT_DUCKING_TRIGGER = {
	enabled: false,
	reductionPercent: 25,
	thresholdDbfs: -35,
	attackSec: 0.25,
	holdSec: 0.5,
	releaseSec: 0.6,
};
export type DuckingTrigger = typeof DEFAULT_DUCKING_TRIGGER;
export function triggerDucking(track: Pick<AxcutAudioTrack, "duckingTrigger">): DuckingTrigger {
	return { ...DEFAULT_DUCKING_TRIGGER, ...track.duckingTrigger };
}
/** Strongest active reduction wins; a trigger is never attenuated by itself. */
export function otherAudioDuckGain(
	targetGroup: string | null,
	sources: ReadonlyMap<string, number>,
) {
	let gain = 1;
	for (const [group, value] of sources) if (group !== targetGroup) gain = Math.min(gain, value);
	return gain;
}
