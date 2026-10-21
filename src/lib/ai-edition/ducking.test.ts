import { expect, it } from "vitest";
import { buildSceneDescription } from "@/native/sceneDescription";
import { patchAudioTrack } from "./document/audioTracks";
import { replaceTimeline } from "./document/timeline";
import { advanceDuckDb, DEFAULT_DUCKING, trackDucking } from "./ducking";
import { createAudioTrack, createEmptyDocument, documentSchema } from "./schema";

it("makes desktop ducking optional and preserves legacy music behavior", () => {
	expect(trackDucking({ kind: "voiceover", recordingSource: "desktop" }).enabled).toBe(false);
	expect(trackDucking({ kind: "music" }).enabled).toBe(true);
});
it("honors depth, attack, hold, release and disabled settings", () => {
	const config = { ...DEFAULT_DUCKING, depthDb: -20, attackSec: 1, releaseSec: 2 };
	expect(advanceDuckDb(0, 0, 0.5, config)).toBe(-10);
	expect(advanceDuckDb(-20, 0.3, 0.1, config)).toBe(-20);
	expect(advanceDuckDb(-20, 1, 1, config)).toBe(-10);
	expect(advanceDuckDb(-20, 0, 1, { ...config, enabled: false })).toBe(0);
});
it("persists shared ducking across fragments and carries it to the export scene", () => {
	const base = createEmptyDocument({ projectId: "duck", title: "Ducking" });
	const track = createAudioTrack({ assetId: "a", durationSec: 5, kind: "music" });
	const doc = {
		...base,
		assets: [
			{
				id: "a",
				kind: "audio" as const,
				originalPath: "/music.wav",
				durationSec: 5,
				label: "Music",
				cameraTrack: null,
			},
		],
		audioTracks: [
			{ ...track, id: "one", trackId: "group" },
			{ ...track, id: "two", trackId: "group", startMs: 5000, endMs: 10000 },
		],
	};
	const withVideo = replaceTimeline(
		{
			...doc,
			project: { ...doc.project, primaryAssetId: "v" },
			assets: [
				...doc.assets,
				{
					id: "v",
					kind: "video",
					originalPath: "/original.mp4",
					durationSec: 10,
					label: "Original",
					cameraTrack: null,
				},
			],
		},
		[{ startSec: 0, endSec: 10 }],
		"Test",
	);
	const next = documentSchema.parse(
		patchAudioTrack({ ...withVideo, audioTracks: doc.audioTracks }, "group", {
			ducking: { ...DEFAULT_DUCKING, depthDb: -18 },
		}),
	);
	expect(next.audioTracks.every((t) => t.ducking?.depthDb === -18)).toBe(true);
	expect(JSON.parse(JSON.stringify(next)).audioTracks[0].ducking.enabled).toBe(true);
	expect(buildSceneDescription(next).audioTracks[0].ducking).toMatchObject({
		enabled: true,
		depthDb: -18,
	});
	expect(buildSceneDescription(next).clips[0].screenPath).toBe("/original.mp4");
});

it("keeps a priority source unchanged and collectively lowers the rest by a percentage", async () => {
	const { otherAudioDuckGain, triggerDucking } = await import("./ducking");
	expect(triggerDucking({}).enabled).toBe(false);
	const sources = new Map([["mic", 0.75]]);
	expect(otherAudioDuckGain("mic", sources)).toBe(1);
	expect(otherAudioDuckGain("music", sources)).toBe(0.75);
	expect(otherAudioDuckGain(null, sources)).toBe(0.75);
	sources.set("voiceover", 0.5);
	expect(otherAudioDuckGain("music", sources)).toBe(0.5);
	expect(otherAudioDuckGain("voiceover", sources)).toBe(0.75);
});
