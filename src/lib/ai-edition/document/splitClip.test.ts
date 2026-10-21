import { describe, expect, it } from "vitest";
import { type AxcutDocument, axcutSchemaVersion, documentSchema } from "../schema";
import { splitClipAtPlayhead } from "./splitClip";
import { removeClip, resolvePlaybackSegments } from "./timeline";

const doc = (over: Partial<AxcutDocument> = {}): AxcutDocument => ({
	schemaVersion: axcutSchemaVersion,
	project: {
		id: "p1",
		title: "t",
		createdAt: "2026-10-08T00:00:00Z",
		updatedAt: "2026-10-08T00:00:00Z",
		primaryAssetId: "a1",
	},
	assets: [
		{
			id: "a1",
			kind: "video",
			label: "take",
			originalPath: "C:/rec/take.mp4",
			video: { codec: "h264", width: 1920, height: 1080, fps: 30 },
			cameraTrack: null,
		},
	],
	transcript: null,
	transcripts: [
		{
			assetId: "a1",
			language: "en",
			segments: [
				{ id: "s1", kind: "speech", startSec: 0, endSec: 6, text: "a b", wordIds: ["w1", "w2"] },
			],
			words: [
				{ id: "w1", segmentId: "s1", startSec: 1, endSec: 4, text: "hello" },
				{ id: "w2", segmentId: "s1", startSec: 5, endSec: 6, text: "world" },
			],
		},
	],
	timeline: {
		clips: [
			{
				id: "c1",
				assetId: "a1",
				sourceStartSec: 0,
				sourceEndSec: 10,
				timelineStartSec: 0,
				timelineEndSec: 10,
				wordRefs: [],
				origin: "user",
				reason: "",
			},
		],
		gaps: [],
		trimRanges: [],
		muteRanges: [],
		speedRanges: [],
		captionRanges: [],
	},
	annotations: [],
	zoomRanges: [],
	audioTracks: [],
	legacyEditor: null,
	...over,
});

describe("split recorded clips", () => {
	it("keeps the footage and gives each half a persistent independent camera layout", () => {
		const base = doc({ legacyEditor: { webcamLayoutPreset: "dual-frame" } });
		const split = splitClipAtPlayhead(base, 4);
		expect(
			split.timeline.clips.map((c) => [
				c.sourceStartSec,
				c.sourceEndSec,
				c.timelineStartSec,
				c.timelineEndSec,
			]),
		).toEqual([
			[0, 4, 0, 4],
			[4, 10, 4, 10],
		]);
		expect(split.timeline.clips.map((c) => c.webcamLayoutPreset)).toEqual([
			"dual-frame",
			"dual-frame",
		]);
		split.timeline.clips[1].webcamLayoutPreset = "no-webcam";
		const saved = documentSchema.parse(split);
		expect(saved.timeline.clips[0].webcamLayoutPreset).toBe("dual-frame");
		expect(saved.timeline.clips[1].webcamLayoutPreset).toBe("no-webcam");
		const extra = {
			...saved.timeline.clips[1],
			id: "unrelated",
			sourceStartSec: 0,
			sourceEndSec: 1,
			timelineStartSec: 10,
			timelineEndSec: 11,
		};
		const removed = removeClip(
			{ ...saved, timeline: { ...saved.timeline, clips: [...saved.timeline.clips, extra] } },
			extra.id,
		);
		expect(removed.timeline.clips).toHaveLength(2);
	});
	it("retains a cut spanning the split without applying it to unrelated duplicate footage", () => {
		const base = doc();
		base.timeline.trimRanges = [
			{
				id: "cut",
				assetId: "a1",
				clipId: "c1",
				startSec: 3,
				endSec: 6,
				origin: "user",
				reason: "",
			},
		];
		const split = splitClipAtPlayhead(base, 4);
		expect(split.timeline.trimRanges).toHaveLength(2);
		const kept = resolvePlaybackSegments(split.timeline.clips, split.timeline.trimRanges);
		expect(kept.map((c) => [c.sourceStartSec, c.sourceEndSec])).toEqual([
			[0, 3],
			[6, 10],
		]);
	});
	it.each([0, 10, -1, NaN])("does nothing outside a clip interior (%s)", (at) => {
		const base = doc();
		expect(splitClipAtPlayhead(base, at)).toBe(base);
	});
});
