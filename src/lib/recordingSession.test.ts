import { describe, expect, it } from "vitest";
import { normalizeRecordedAudioSources, normalizeRecordingSession } from "./recordingSession";

describe("separate recorded audio metadata", () => {
	it("preserves both source paths across the recorder handoff", () => {
		const audioSources = [
			{ source: "microphone", path: "/mic.wav" },
			{ source: "desktop", path: "/desktop.wav" },
		];
		expect(
			normalizeRecordingSession({ screenVideoPath: "/video.mp4", createdAt: 1, audioSources })
				?.audioSources,
		).toEqual(audioSources);
	});
	it("ignores malformed and duplicate sources", () => {
		expect(
			normalizeRecordedAudioSources([
				null,
				{ path: " ", source: "microphone" },
				{ path: "/a", source: "other" },
				{ path: " /mic.wav ", source: "microphone" },
				{ path: "/b", source: "microphone" },
				{ path: "/mic.wav", source: "desktop" },
			]),
		).toEqual([{ path: "/mic.wav", source: "microphone" }]);
	});
	it("does not add sources to older recordings", () => {
		expect(normalizeRecordingSession({ screenVideoPath: "/old.mp4", createdAt: 1 })).toEqual({
			screenVideoPath: "/old.mp4",
			createdAt: 1,
		});
	});
});
