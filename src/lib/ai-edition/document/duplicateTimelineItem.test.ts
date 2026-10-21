import { expect, it } from "vitest";
import {
	annotationRegionSchema,
	assetSchema,
	clipSchema,
	createAudioTrack,
	createEmptyDocument,
	documentSchema,
} from "../schema";
import { duplicatePlacement, duplicateTimelineItem } from "./duplicateTimelineItem";

function document() {
	const doc = createEmptyDocument({ projectId: "test", title: "Test" });
	doc.assets = [
		assetSchema.parse({
			id: "v",
			kind: "video",
			label: "Video",
			originalPath: "/video.mp4",
			durationSec: 30,
			origin: "user",
		}),
	];
	doc.timeline.clips = [
		clipSchema.parse({
			id: "clip",
			assetId: "v",
			origin: "user",
			sourceStartSec: 4,
			sourceEndSec: 24,
			timelineStartSec: 0,
			timelineEndSec: 20,
		}),
	];
	return doc;
}
it("finds a free span or reports a full lane without changing it", () => {
	expect(duplicatePlacement(0, 5, [{ start: 0, end: 5 }], 20)).toBeGreaterThan(5);
	expect(duplicatePlacement(0, 20, [{ start: 0, end: 20 }], 20)).toBeNull();
});
it("duplicates source-anchored trims onto the correct source window", () => {
	const doc = document();
	doc.timeline.trimRanges = [
		{
			id: "trim",
			assetId: "v",
			clipId: "clip",
			startSec: 6,
			endSec: 8,
			reason: "manual",
			origin: "user",
		},
	];
	const copy = duplicateTimelineItem(doc, "trim", "trim");
	expect(copy.timeline.trimRanges).toHaveLength(2);
	const next = copy.timeline.trimRanges[1];
	expect(next.id).not.toBe("trim");
	expect(next.clipId).toBe("clip");
	expect(next.startSec).toBeGreaterThan(8);
	expect(next.endSec - next.startSec).toBeCloseTo(2);
	expect(documentSchema.safeParse(copy).success).toBe(true);
});
it("preserves speed payloads on the legacy envelope and anchors the new copy", () => {
	const doc = document();
	doc.legacyEditor = { speedRegions: [{ id: "speed", startMs: 2000, endMs: 4000, speed: 2 }] };
	const copy = duplicateTimelineItem(doc, "speed", "speed");
	const speeds = copy.legacyEditor?.speedRegions as Array<{
		id: string;
		speed: number;
		clipId: string;
	}>;
	expect(speeds).toHaveLength(2);
	expect(speeds[1]).toMatchObject({ speed: 2, clipId: "clip" });
	expect(documentSchema.safeParse(copy).success).toBe(true);
});
it("duplicates audio as an independent group with its mix and source window intact", () => {
	const doc = document();
	doc.assets.push(
		assetSchema.parse({
			id: "audio",
			kind: "audio",
			originalPath: "/microphone.wav",
			label: "Microphone",
			durationSec: 20,
			origin: "user",
		}),
	);
	const track = {
		...createAudioTrack({ assetId: "audio", durationSec: 20, timelineStartSec: 2, spanSec: 4 }),
		id: "a",
		trackId: "a",
		startMs: 2000,
		endMs: 6000,
		offsetMs: 1000,
		gainDb: -6,
		muted: true,
		fadeInMs: 150,
		fadeOutMs: 300,
		recordingSource: "microphone" as const,
	};
	doc.audioTracks = [track];
	const copy = duplicateTimelineItem(doc, "audio", "a");
	expect(copy.audioTracks).toHaveLength(2);
	expect(copy.audioTracks[1].trackId).not.toBe("a");
	expect(copy.audioTracks[1]).toMatchObject({
		startMs: 2000,
		endMs: 6000,
		offsetMs: 1000,
		gainDb: -6,
		muted: true,
		fadeInMs: 150,
		fadeOutMs: 300,
		recordingSource: "microphone",
	});
	expect(documentSchema.safeParse(copy).success).toBe(true);
});

it("duplicates a full-span visual layer without requiring a free horizontal gap", () => {
	const doc = document();
	doc.annotations = [
		annotationRegionSchema.parse({
			id: "image",
			type: "image",
			startMs: 0,
			endMs: 20000,
			content: "data:image/png;base64,AQID",
			position: { x: 25, y: 25 },
			size: { width: 50, height: 50 },
			mediaAssetId: "overlay",
			mediaLayerId: "original-layer",
			mediaOffsetMs: 0,
			mediaSourceStartSec: 0,
			style: { textAnimation: "fade" },
			zIndex: 1,
		}),
	];
	const copy = duplicateTimelineItem(doc, "annotation", "image");
	expect(copy.annotations).toHaveLength(2);
	expect(copy.annotations[1]).toMatchObject({
		startMs: 0,
		endMs: 20000,
		mediaAssetId: "overlay",
		mediaOffsetMs: 0,
		style: { textAnimation: "fade" },
		zIndex: 2,
	});
	expect(copy.annotations[1].mediaLayerId).not.toBe("original-layer");
	expect(documentSchema.safeParse(copy).success).toBe(true);
});
