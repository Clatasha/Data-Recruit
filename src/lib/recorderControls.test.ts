import { expect, it } from "vitest";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	validLiveAudioMix,
	validRecordingShortcuts,
} from "./recorderControls";

it("validates audio levels before they cross the helper command channel", () => {
	expect(validLiveAudioMix({ microphone: 0, system: 1 })).toBe(true);
	for (const microphone of [-1, Infinity, NaN, 2.1, "0\nstop"])
		expect(validLiveAudioMix({ microphone, system: 1 })).toBe(false);
	expect(validLiveAudioMix(null)).toBe(false);
});
it("requires a complete, safe global shortcut configuration", () => {
	expect(validRecordingShortcuts(DEFAULT_RECORDING_SHORTCUTS)).toBe(true);
	expect(validRecordingShortcuts({})).toBe(false);
	expect(
		validRecordingShortcuts({ ...DEFAULT_RECORDING_SHORTCUTS, record: { key: "r+q", ctrl: true } }),
	).toBe(false);
});
