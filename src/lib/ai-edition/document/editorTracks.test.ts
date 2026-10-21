import { describe, expect, it } from "vitest";
import { buildSceneDescription } from "@/native/sceneDescription";
import {
	annotationRegionSchema,
	assetSchema,
	clipSchema,
	createAudioTrack,
	createEmptyDocument,
	documentSchema,
} from "../schema";
import { anchorRegionsWithDerivedMs } from "../timeline/timelineMap";
import { anchorAudioTrackFragments, collapseTracksToPills } from "./audioTracks";
import {
	attachClipAudio,
	canRemoveEditorTrack,
	changesLockedTracks,
	duplicateLinkedClip,
	duplicateLinkedItem,
	editorTracks,
	itemRows,
	linkEditorItems,
	linkedItemRefs,
	moveEditorItems,
	moveLinkedClip,
	patchEditorItem,
	patchEditorTrack,
	pruneEmptyAutomaticTracks,
	relinkEditorAsset,
	removeEditorTrack,
	removeLibraryAsset,
	removeLinkedEditorItems,
	unlinkEditorItems,
	visibleEditorDocument,
} from "./editorTracks";

function fixture() {
	const doc = createEmptyDocument({ projectId: "library-test", title: "Reaction" });
	doc.assets = [
		assetSchema.parse({
			origin: "user",
			id: "v",
			kind: "video",
			label: "Reaction video",
			originalPath: "/video.mp4",
			durationSec: 30,
		}),
		assetSchema.parse({
			origin: "user",
			id: "sound",
			kind: "audio",
			label: "Sound",
			originalPath: "/video.mp4",
			durationSec: 30,
		}),
	];
	doc.timeline.clips = [
		clipSchema.parse({
			origin: "user",
			id: "c1",
			assetId: "v",
			sourceStartSec: 0,
			sourceEndSec: 10,
			timelineStartSec: 0,
			timelineEndSec: 10,
		}),
		clipSchema.parse({
			origin: "user",
			id: "c2",
			assetId: "v",
			sourceStartSec: 10,
			sourceEndSec: 20,
			timelineStartSec: 10,
			timelineEndSec: 20,
		}),
	];
	doc.annotations = [
		annotationRegionSchema.parse({
			position: { x: 25, y: 25 },
			size: { width: 50, height: 50 },
			zIndex: 1,
			id: "visual",
			type: "image",
			mediaAssetId: "v",
			mediaLayerId: "visual-group",
			mediaOffsetMs: 2000,
			mediaSourceStartSec: 1,
			startMs: 2000,
			endMs: 6000,
			content: "Video",
			editorTrackId: "visual-track",
			linkGroupId: "pair",
			style: { textAnimation: "fade" },
		}),
	];
	doc.audioTracks = [
		{
			...createAudioTrack({ assetId: "sound", durationSec: 30, timelineStartSec: 2, spanSec: 4 }),
			id: "audio",
			trackId: "audio-group",
			editorTrackId: "sound-track",
			linkGroupId: "pair",
			offsetMs: 1000,
			gainDb: -4,
		},
	];
	doc.timeline.tracks = editorTracks(doc);
	return doc;
}
describe("Library tracks", () => {
	it("provides eight useful lanes for an old project without rewriting it", () => {
		const doc = createEmptyDocument({ projectId: "old", title: "Old" });
		expect(editorTracks(doc)).toHaveLength(8);
		expect(doc.timeline.tracks).toBeUndefined();
	});
	it("expands either half of linked media and deduplicates fragments", () => {
		const doc = fixture();
		expect(linkedItemRefs(doc, [{ kind: "audio", id: "audio" }])).toEqual([
			{ kind: "audio", id: "audio-group" },
			{ kind: "annotation", id: "visual-group" },
		]);
		expect(
			linkedItemRefs(doc, [
				{ kind: "audio", id: "audio" },
				{ kind: "annotation", id: "visual" },
			]),
		).toHaveLength(2);
	});
	it("moves linked sound and picture together without changing offsets or animation", () => {
		const doc = fixture();
		const next = moveEditorItems(doc, [{ kind: "audio", id: "audio" }], 3000);
		expect(next.annotations[0]).toMatchObject({
			startMs: 5000,
			endMs: 9000,
			mediaOffsetMs: 5000,
			mediaSourceStartSec: 1,
			style: { textAnimation: "fade" },
		});
		expect(collapseTracksToPills(next.audioTracks)[0]).toMatchObject({
			startMs: 5000,
			endMs: 9000,
			offsetMs: 1000,
			gainDb: -4,
		});
		expect(doc.annotations[0].startMs).toBe(2000);
	});
	it("preserves continuous source playback when moving across a recording cut", () => {
		const next = moveEditorItems(fixture(), [{ kind: "annotation", id: "visual" }], 6000);
		expect(next.audioTracks).toHaveLength(2);
		expect(next.audioTracks.map((track) => [track.startMs, track.endMs, track.offsetMs])).toEqual([
			[8000, 10000, 1000],
			[10000, 12000, 3000],
		]);
		expect(collapseTracksToPills(next.audioTracks)[0]).toMatchObject({
			startMs: 8000,
			endMs: 12000,
			offsetMs: 1000,
		});
	});
	it("clamps one multi-selection while preserving spacing and sync", () => {
		const doc = fixture();
		doc.audioTracks.push({
			...doc.audioTracks[0],
			id: "music",
			trackId: "music",
			editorTrackId: "music-track",
			startMs: 8000,
			endMs: 11000,
			linkGroupId: undefined,
		});
		const next = moveEditorItems(
			doc,
			[
				{ kind: "annotation", id: "visual" },
				{ kind: "audio", id: "music" },
			],
			-9000,
		);
		expect(next.annotations[0].startMs).toBe(0);
		expect(
			collapseTracksToPills(next.audioTracks)
				.map((track) => track.startMs)
				.sort((a, b) => a - b),
		).toEqual([0, 6000]);
	});
	it("clamps the entire selected group at the programme end", () => {
		const next = moveEditorItems(fixture(), [{ kind: "audio", id: "audio" }], 50000);
		expect(next.annotations.at(-1)?.endMs).toBe(20000);
		expect(next.audioTracks.at(-1)?.endMs).toBe(20000);
	});
	it("blocks a linked drag when its other track is locked", () => {
		const doc = patchEditorTrack(fixture(), "sound-track", { locked: true });
		expect(moveEditorItems(doc, [{ kind: "annotation", id: "visual" }], 2000)).toBe(doc);
		expect(unlinkEditorItems(doc, { kind: "annotation", id: "visual" })).toBe(doc);
	});
	it("allows unlocking but catches shortcut, trim and delete edits to locked contents", () => {
		const doc = patchEditorTrack(fixture(), "visual-track", { locked: true });
		expect(changesLockedTracks(doc, { ...doc, annotations: [] })).toBe(true);
		expect(changesLockedTracks(doc, patchEditorTrack(doc, "visual-track", { locked: false }))).toBe(
			false,
		);
		expect(patchEditorItem(doc, { kind: "annotation", id: "visual" }, { disabled: true })).toBe(
			doc,
		);
		const locked = patchEditorTrack(doc, "effect:trim", { locked: true });
		expect(
			changesLockedTracks(locked, {
				...locked,
				timeline: {
					...locked.timeline,
					trimRanges: [
						{ id: "cut", assetId: "v", startSec: 0, endSec: 1, origin: "user", reason: "Cut" },
					],
				},
			}),
		).toBe(true);
	});
	it("moves an item between compatible tracks and refuses a locked target", () => {
		let doc = fixture();
		doc.timeline.tracks?.push({
			id: "destination",
			kind: "visual",
			label: "Stickers",
			locked: false,
			hidden: false,
			muted: false,
		});
		const next = moveEditorItems(doc, [{ kind: "annotation", id: "visual" }], 0, "destination");
		expect(next.annotations[0].editorTrackId).toBe("destination");
		doc = patchEditorTrack(doc, "destination", { locked: true });
		expect(moveEditorItems(doc, [{ kind: "annotation", id: "visual" }], 0, "destination")).toBe(
			doc,
		);
	});
	it("unlinks every fragment and allows deliberate relinking", () => {
		const doc = unlinkEditorItems(fixture(), { kind: "audio", id: "audio" });
		expect(doc.audioTracks[0].linkGroupId).toBeUndefined();
		expect(doc.annotations[0].linkGroupId).toBeUndefined();
		const next = linkEditorItems(doc, [
			{ kind: "audio", id: "audio" },
			{ kind: "annotation", id: "visual" },
		]);
		expect(next.audioTracks[0].linkGroupId).toBe(next.annotations[0].linkGroupId);
	});
	it("keeps disabled items on the timeline while excluding preview/export layers", () => {
		const doc = patchEditorItem(
			fixture(),
			{ kind: "annotation", id: "visual" },
			{ disabled: true },
		);
		expect(doc.annotations).toHaveLength(1);
		expect(visibleEditorDocument(doc).annotations).toHaveLength(0);
		expect(buildSceneDescription(doc).annotations).toHaveLength(0);
	});
	it("mutes a whole track in the native mix and hides recording frames without removing time", () => {
		let doc = patchEditorTrack(fixture(), "sound-track", { muted: true });
		doc = patchEditorTrack(doc, "main-video", { hidden: true });
		const scene = buildSceneDescription(doc);
		expect(scene.audioTracks).toHaveLength(0);
		expect(scene.clips).toHaveLength(2);
		expect(scene.clips.every((clip) => clip.screenHidden)).toBe(true);
		expect(doc.timeline.clips.at(-1)?.timelineEndSec).toBe(20);
	});
	it("round-trips names, links, flags, custom tracks, and sticker assets", () => {
		let doc = patchEditorTrack(fixture(), "sound-track", {
			label: "Music bed",
			muted: true,
			locked: true,
		});
		doc = patchEditorItem(
			doc,
			{ kind: "annotation", id: "visual" },
			{ disabled: true, editorLabel: "My reaction" },
		);
		doc.assets[0].libraryCategory = "sticker";
		expect(documentSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
	});
	it("reordering a recording carries clip-anchored audio", () => {
		const doc = fixture();
		doc.timeline.clips[0].linkGroupId = "original";
		doc.audioTracks = anchorAudioTrackFragments(
			{ ...doc.audioTracks[0], startMs: 0, endMs: 10000, linkGroupId: "original" },
			doc.timeline.clips,
			() => "fragment",
		);
		const next = moveLinkedClip(doc, "c1", 1);
		expect(next.timeline.clips.map((clip) => clip.id)).toEqual(["c2", "c1"]);
		expect(next.audioTracks[0]).toMatchObject({ startMs: 10000, endMs: 20000, clipId: "c1" });
	});
	it("recognizes annotation fragments through their stable layer id", () => {
		const doc = fixture();
		doc.annotations = anchorRegionsWithDerivedMs(
			[{ ...doc.annotations[0], startMs: 8000, endMs: 12000 }],
			doc.timeline.clips,
			() => "second",
		);
		expect(itemRows(doc, { kind: "annotation", id: "visual-group" })).toHaveLength(2);
	});
});

it("separates one trimmed recording into linked sound with the correct source offset", () => {
	const doc = fixture();
	doc.timeline.clips[0].sourceStartSec = 2;
	doc.timeline.clips[0].sourceEndSec = 12;
	const next = attachClipAudio(doc, "c1", "sound");
	const sound = next.audioTracks.find(
		(track) => track.linkGroupId === next.timeline.clips[0].linkGroupId,
	)!;
	expect(next.timeline.clips[0].embeddedAudioMuted).toBe(true);
	expect(sound).toMatchObject({ startMs: 0, endMs: 10000, offsetMs: 2000, clipId: "c1" });
	expect(buildSceneDescription(next).clips[0].hasAudio).toBe(false);
	expect(buildSceneDescription(next).clips[1].hasAudio).toBe(true);
});
it("duplicates both halves of linked overlays into an independent pair", () => {
	const doc = fixture();
	const next = duplicateLinkedItem(doc, "annotation", "visual");
	expect(next.annotations).toHaveLength(2);
	expect(next.audioTracks).toHaveLength(2);
	expect(next.annotations[1].linkGroupId).toBe(next.audioTracks[1].linkGroupId);
	expect(next.annotations[1].linkGroupId).not.toBe("pair");
	expect(next.annotations[1].mediaLayerId).not.toBe(doc.annotations[0].mediaLayerId);
});
it("duplicates separated recording audio with its new recording section", () => {
	const doc = attachClipAudio(fixture(), "c1", "sound");
	const next = duplicateLinkedClip(doc, "c1");
	const copy = next.timeline.clips[1];
	const sound = next.audioTracks.find((track) => track.linkGroupId === copy.linkGroupId)!;
	expect(copy.linkGroupId).not.toBe(doc.timeline.clips[0].linkGroupId);
	expect(sound).toMatchObject({ startMs: 10000, endMs: 20000, clipId: copy.id });
	expect(documentSchema.safeParse(next).success).toBe(true);
});
it("locates a moved video and its extracted sound while keeping all timeline edits", () => {
	const doc = fixture();
	const replacement = {
		...doc.assets[0],
		id: "found",
		originalPath: "/moved/video.mp4",
		proxyPath: undefined,
	};
	doc.assets.push(replacement);
	const next = relinkEditorAsset(doc, "v", replacement);
	expect(next.assets.find((asset) => asset.id === "v")?.originalPath).toBe("/moved/video.mp4");
	expect(next.assets.find((asset) => asset.id === "sound")?.originalPath).toBe("/moved/video.mp4");
	expect(next.assets.some((asset) => asset.id === "found")).toBe(false);
	expect(next.timeline).toBe(doc.timeline);
	expect(next.annotations).toBe(doc.annotations);
	expect(next.audioTracks).toBe(doc.audioTracks);
});
it("rejects a replacement too short for the edited source or of a different media type", () => {
	const doc = fixture();
	expect(() =>
		relinkEditorAsset(doc, "v", { ...doc.assets[0], id: "found", durationSec: 1 }),
	).toThrow(/shorter/);
	expect(() => relinkEditorAsset(doc, "v", doc.assets[1])).toThrow(/type/);
});

it("moves a linked pair into adjacent compatible tracks", () => {
	const doc = fixture();
	doc.timeline.tracks?.push({
		id: "target",
		kind: "visual",
		label: "B roll",
		hidden: false,
		muted: false,
		locked: false,
	});
	const next = moveEditorItems(doc, [{ kind: "annotation", id: "visual" }], 1000, "target");
	const visual = next.annotations[0];
	const audio = next.audioTracks[0];
	const tracks = editorTracks(next);
	expect(visual.editorTrackId).toBe("target");
	expect(tracks.findIndex((track) => track.id === audio.editorTrackId)).toBe(
		tracks.findIndex((track) => track.id === "target") + 1,
	);
	expect(audio.startMs).toBe(visual.startMs);
});
it("deletes linked media together while leaving the reusable files in the bin", () => {
	const doc = fixture();
	const next = removeLinkedEditorItems(doc, { kind: "annotation", id: "visual" });
	expect(next.annotations).toHaveLength(0);
	expect(next.audioTracks).toHaveLength(0);
	expect(next.assets).toBe(doc.assets);
	const locked = patchEditorTrack(doc, "sound-track", { locked: true });
	expect(removeLinkedEditorItems(locked, { kind: "annotation", id: "visual" })).toBe(locked);
});

it("dragging separated audio reorders its recording section as a synchronized pair", () => {
	const doc = attachClipAudio(fixture(), "c1", "sound");
	const sound = doc.audioTracks.find(
		(row) => row.linkGroupId === doc.timeline.clips[0].linkGroupId,
	)!;
	const next = moveEditorItems(doc, [{ kind: "audio", id: sound.id }], 10000);
	expect(next.timeline.clips.map((clip) => clip.id)).toEqual(["c2", "c1"]);
	expect(
		next.audioTracks.find((row) => row.linkGroupId === doc.timeline.clips[0].linkGroupId)?.startMs,
	).toBe(10000);
});
it("moves adjacent selected recording sections as one ripple block", () => {
	const doc = fixture();
	doc.timeline.clips.push({
		...doc.timeline.clips[1],
		id: "c3",
		sourceStartSec: 20,
		sourceEndSec: 30,
		timelineStartSec: 20,
		timelineEndSec: 30,
	});
	const next = moveEditorItems(
		doc,
		[
			{ kind: "clip", id: "c1" },
			{ kind: "clip", id: "c2" },
		],
		10000,
	);
	expect(next.timeline.clips.map((clip) => clip.id)).toEqual(["c3", "c1", "c2"]);
	expect(next.timeline.clips[2].timelineStartSec - next.timeline.clips[1].timelineStartSec).toBe(
		10,
	);
});

it("deletes an independent audio duplicate by its displayed group id", () => {
	const doc = unlinkEditorItems(fixture(), { kind: "audio", id: "audio-group" });
	const next = duplicateLinkedItem(doc, "audio", "audio-group");
	const originalIds = new Set(doc.audioTracks.map((row) => row.id));
	const copy = next.audioTracks.find((row) => !originalIds.has(row.id))!;
	const pill = collapseTracksToPills(next.audioTracks).find(
		(row) => row.id === (copy.trackId ?? copy.id),
	)!;
	expect(pill).toBeDefined();
	const removed = removeLinkedEditorItems(next, { kind: "audio", id: pill.id });
	expect(removed.audioTracks).toEqual(doc.audioTracks);
});

it("removes vacated automatic lanes but preserves manual and shared lanes", () => {
	const doc = fixture();
	doc.timeline.tracks = editorTracks(doc).map((track) => ({ ...track, autoCreated: true }));
	doc.timeline.tracks.push({
		id: "manual",
		kind: "visual",
		label: "My lane",
		locked: false,
		hidden: false,
		muted: false,
		autoCreated: false,
	});
	const removed = removeLinkedEditorItems(doc, { kind: "annotation", id: "visual" });
	expect(
		removed.timeline.tracks?.some(
			(track) => track.id === "visual-track" || track.id === "sound-track",
		),
	).toBe(false);
	expect(removed.timeline.tracks?.some((track) => track.id === "manual")).toBe(true);
	const shared = {
		...doc,
		annotations: [
			...doc.annotations,
			{ ...doc.annotations[0], id: "other", mediaLayerId: "other", linkGroupId: undefined },
		],
	};
	expect(
		removeLinkedEditorItems(shared, { kind: "annotation", id: "visual" }).timeline.tracks?.some(
			(track) => track.id === "visual-track",
		),
	).toBe(true);
	expect(pruneEmptyAutomaticTracks(doc, doc)).toBe(doc);
});
it("places recording, desktop and microphone below the editing tracks", () => {
	const doc = fixture();
	doc.audioTracks = [
		{
			...doc.audioTracks[0],
			id: "mic",
			trackId: undefined,
			recordingSource: "microphone",
			origin: "system",
			editorTrackId: "mic-lane",
		},
		{
			...doc.audioTracks[0],
			id: "desktop",
			trackId: undefined,
			recordingSource: "desktop",
			origin: "system",
			editorTrackId: "desktop-lane",
		},
		...doc.audioTracks,
	];
	const tracks = editorTracks(doc);
	expect(tracks.slice(-3).map((track) => track.id)).toEqual([
		"main-video",
		"desktop-lane",
		"mic-lane",
	]);
	expect(moveEditorItems(doc, [{ kind: "audio", id: "mic" }], 0, "sound-track")).toBe(doc);
});

it("removes empty manual/default tracks permanently while preserving populated and original tracks", () => {
	const doc = fixture();
	doc.timeline.tracks = [
		...editorTracks(doc),
		{
			id: "manual",
			kind: "audio",
			label: "Empty",
			autoCreated: false,
			locked: false,
			hidden: false,
			muted: false,
		},
	];
	const next = removeEditorTrack(doc, "manual");
	expect(editorTracks(next).some((row) => row.id === "manual")).toBe(false);
	expect(documentSchema.parse(next).timeline.removedTrackIds).toContain("manual");
	expect(removeEditorTrack(doc, "main-video")).toBe(doc);
	const defaultLane = removeEditorTrack(doc, "audio-empty-2");
	expect(editorTracks(defaultLane).some((row) => row.id === "audio-empty-2")).toBe(false);
	const populated = removeEditorTrack(doc, "visual-track");
	expect(populated.annotations).toHaveLength(0);
	expect(populated.audioTracks).toHaveLength(0);
	expect(editorTracks(populated).some((row) => row.id === "visual-track")).toBe(false);
	expect(doc.annotations).toHaveLength(1);
	expect(
		canRemoveEditorTrack(patchEditorTrack(doc, "sound-track", { locked: true }), "visual-track"),
	).toBe(false);
});
it("keeps original capture lanes protected from manual removal", () => {
	const doc = fixture();
	doc.audioTracks[0] = { ...doc.audioTracks[0], origin: "system", recordingSource: "desktop" };
	expect(removeEditorTrack(doc, "sound-track")).toBe(doc);
});
it("removes a Library entry without removing timeline copies or source files", () => {
	const doc = fixture();
	const next = removeLibraryAsset(doc, "v");
	expect(next.assets.find((asset) => asset.id === "v")?.libraryHidden).toBe(true);
	expect(next.timeline.clips).toBe(doc.timeline.clips);
	expect(next.annotations).toBe(doc.annotations);
	expect(next.audioTracks).toBe(doc.audioTracks);
	expect(documentSchema.safeParse(next).success).toBe(true);
	expect(buildSceneDescription(next).clips).toEqual(buildSceneDescription(doc).clips);
});
it("appends source audio on the existing Desktop Audio lane with its clip offsets and link", () => {
	const doc = fixture();
	doc.audioTracks[0] = {
		...doc.audioTracks[0],
		origin: "system",
		recordingSource: "desktop",
		linkGroupId: undefined,
	};
	const next = attachClipAudio(doc, "c2", "sound");
	const added = next.audioTracks.find((row) => row.clipId === "c2")!;
	expect(added).toMatchObject({
		editorTrackId: "sound-track",
		recordingSource: "desktop",
		startMs: 10000,
		endMs: 20000,
		offsetMs: 10000,
	});
	expect(added.linkGroupId).toBe(next.timeline.clips[1].linkGroupId);
	expect(editorTracks(next).filter((track) => track.kind === "audio")).toHaveLength(
		editorTracks(doc).filter((track) => track.kind === "audio").length,
	);
	expect(
		buildSceneDescription(next).audioTracks.some(
			(track) => track.path === "/video.mp4" && track.recordedSource === true,
		),
	).toBe(true);
});
