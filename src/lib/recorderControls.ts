import type { ShortcutBinding } from "./shortcuts";

export const RECORDING_ACTIONS = ["record", "pause", "muteMicrophone", "muteSystem"] as const;
export type RecordingAction = (typeof RECORDING_ACTIONS)[number];
export type RecordingShortcuts = Record<RecordingAction, ShortcutBinding>;
export const DEFAULT_RECORDING_SHORTCUTS: RecordingShortcuts = {
	record: { key: "r", ctrl: true, shift: true },
	pause: { key: "p", ctrl: true, shift: true },
	muteMicrophone: { key: "m", ctrl: true, shift: true },
	muteSystem: { key: "s", ctrl: true, shift: true },
};
export type LiveAudioMix = { microphone: number; system: number };
export function validLiveAudioMix(value: unknown): value is LiveAudioMix {
	if (!value || typeof value !== "object") return false;
	const mix = value as LiveAudioMix;
	return [mix.microphone, mix.system].every(
		(gain) => typeof gain === "number" && Number.isFinite(gain) && gain >= 0 && gain <= 2,
	);
}
export function validRecordingShortcuts(value: unknown): value is RecordingShortcuts {
	if (!value || typeof value !== "object") return false;
	const config = value as RecordingShortcuts;
	return RECORDING_ACTIONS.every((action) => {
		const binding = config[action];
		return (
			binding &&
			typeof binding.key === "string" &&
			/^(?:[a-z0-9]|f(?:[1-9]|1[0-9]|2[0-4]))$/i.test(binding.key) &&
			[binding.ctrl, binding.shift, binding.alt].every(
				(mod) => mod === undefined || typeof mod === "boolean",
			) &&
			(binding.ctrl || binding.alt || /^f\d+$/i.test(binding.key))
		);
	});
}
