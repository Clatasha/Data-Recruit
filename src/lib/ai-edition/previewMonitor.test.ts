// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { monitorGainDb, usePreviewMonitor } from "./previewMonitor";

afterEach(() => {
	usePreviewMonitor.setState({ volume: 1, muted: false, recordingMuted: false });
	localStorage.clear();
});
it("applies linear preview volume and restores it after temporary voice-over muting", () => {
	usePreviewMonitor.getState().setVolume(0.5);
	expect(10 ** (monitorGainDb() / 20)).toBeCloseTo(0.5);
	usePreviewMonitor.setState({ recordingMuted: true });
	expect(10 ** (monitorGainDb() / 20)).toBe(0);
	usePreviewMonitor.setState({ recordingMuted: false });
	expect(10 ** (monitorGainDb() / 20)).toBeCloseTo(0.5);
	usePreviewMonitor.getState().setMuted(true);
	expect(10 ** (monitorGainDb() / 20)).toBe(0);
});
it("persists monitoring preferences, but never recording mute or project/export settings", () => {
	usePreviewMonitor.getState().setVolume(0.25);
	usePreviewMonitor.setState({ recordingMuted: true });
	expect(JSON.parse(localStorage.getItem("reaction-station.monitor")!).state).toEqual({
		volume: 0.25,
		muted: false,
	});
});
it("clamps invalid levels", () => {
	usePreviewMonitor.getState().setVolume(-4);
	expect(usePreviewMonitor.getState().volume).toBe(0);
	usePreviewMonitor.getState().setVolume(6);
	expect(usePreviewMonitor.getState().volume).toBe(1);
	usePreviewMonitor.getState().setVolume(NaN);
	expect(usePreviewMonitor.getState().volume).toBe(1);
});
