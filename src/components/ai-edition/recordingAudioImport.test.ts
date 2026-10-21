import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	patchAudioTrack,
	placeAudioTrackInDocument,
	separateAudioLanes,
} from "@/lib/ai-edition/document/audioTracks";
import { replaceTimeline } from "@/lib/ai-edition/document/timeline";
import { type AxcutAsset, createEmptyDocument, documentSchema } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { buildSceneDescription } from "@/native/sceneDescription";
import { attachRecordingAudio, importRecordingAudioSources } from "./recordingAudioImport";

function fixture(seconds = 12) {
	let doc = createEmptyDocument({ projectId: "p", title: "Take" });
	const video: AxcutAsset = {
		id: "v",
		kind: "video",
		label: "Video",
		originalPath: "/screen.mp4",
		durationSec: seconds,
		cameraTrack: null,
	};
	const mic: AxcutAsset = {
		id: "mic",
		kind: "audio",
		label: "Microphone",
		originalPath: "/mic.wav",
		durationSec: seconds,
		cameraTrack: null,
	};
	const desktop: AxcutAsset = {
		id: "desktop",
		kind: "audio",
		label: "Desktop audio",
		originalPath: "/desktop.wav",
		durationSec: seconds,
		cameraTrack: null,
	};
	doc = { ...doc, project: { ...doc.project, primaryAssetId: "v" }, assets: [video, mic, desktop] };
	doc = replaceTimeline(doc, [{ startSec: 0, endSec: seconds }], "Test");
	return { doc, mic, desktop };
}
describe("independent recording audio", () => {
	it("creates simultaneous labelled tracks, suppresses the fallback, and round-trips", () => {
		const { doc, mic, desktop } = fixture();
		const next = documentSchema.parse(
			attachRecordingAudio(doc, "/screen.mp4", [
				{ source: "microphone", asset: mic },
				{ source: "desktop", asset: desktop },
			]),
		);
		expect(next.audioTracks.map((t) => [t.label, t.startMs, t.endMs, t.gainDb])).toEqual([
			["Microphone", 0, 12000, 0],
			["Desktop audio", 0, 12000, 0],
		]);
		expect(next.assets[0].sourceAudioMuted).toBe(true);
		expect(separateAudioLanes(next.audioTracks)).toBe(next.audioTracks);
		const moved = placeAudioTrackInDocument(
			next,
			{ ...next.audioTracks[0], startMs: 1000, endMs: 11000 },
			() => "moved",
			"move",
		);
		expect(moved.audioTracks.find((t) => t.recordingSource === "microphone")?.startMs).toBe(1000);
		expect(moved.audioTracks.find((t) => t.recordingSource === "desktop")?.startMs).toBe(0);
		expect(documentSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
		const changed = patchAudioTrack(next, next.audioTracks[0].trackId ?? next.audioTracks[0].id, {
			gainDb: -6,
			muted: true,
			fadeInMs: 500,
		});
		expect(changed.audioTracks[1]).toEqual(next.audioTracks[1]);
		const scene = buildSceneDescription(changed);
		expect(scene.clips[0].hasAudio).toBe(false);
		expect(scene.audioTracks).toHaveLength(1);
		expect(scene.audioTracks[0]).toMatchObject({
			path: "/desktop.wav",
			gainDb: 0,
			recordedSource: true,
		});
	});
	it("extends a provisional minute-long timeline for a long take", () => {
		const { doc, mic } = fixture(180);
		const provisional = replaceTimeline(
			{
				...doc,
				assets: doc.assets.map((a) => (a.id === "v" ? { ...a, durationSec: undefined } : a)),
			},
			[{ startSec: 0, endSec: 60 }],
			"Placeholder",
		);
		const next = attachRecordingAudio(provisional, "/screen.mp4", [
			{ source: "microphone", asset: mic },
		]);
		expect(next.timeline.clips[0].timelineEndSec).toBe(180);
		expect(next.audioTracks[0].endMs).toBe(180000);
	});
	it("keeps both recorded sources in sync across trims and speed changes", () => {
		const { doc, mic, desktop } = fixture();
		let next = attachRecordingAudio(doc, "/screen.mp4", [
			{ source: "microphone", asset: mic },
			{ source: "desktop", asset: desktop },
		]);
		const clip = next.timeline.clips[0];
		next = {
			...next,
			legacyEditor: { speedRegions: [{ id: "fast", startMs: 6000, endMs: 10000, speed: 2 }] },
			timeline: {
				...next.timeline,
				trimRanges: [
					{
						id: "cut",
						clipId: clip.id,
						assetId: "v",
						startSec: 2,
						endSec: 4,
						reason: "Test",
						origin: "user",
					},
				],
			},
		};
		const scene = buildSceneDescription(next);
		const a = scene.audioTracks.filter((t) => t.path === "/mic.wav");
		const b = scene.audioTracks.filter((t) => t.path === "/desktop.wav");
		expect(a.every((entry) => entry.recordingSource === "microphone")).toBe(true);
		expect(b.every((entry) => entry.recordingSource === "desktop")).toBe(true);
		expect(a.map(({ path, recordingSource, groupId, ...entry }) => entry)).toEqual(
			b.map(({ path, recordingSource, groupId, ...entry }) => entry),
		);
		expect(a.map((t) => [t.trimStartSec, t.trimEndSec, t.startSec, t.outputDurationSec])).toEqual([
			[0, 2, 0, 2],
			[4, 6, 2, 2],
			[6, 10, 4, 2],
			[10, 12, 6, 2],
		]);
	});
	it("does not suppress the fallback when duration probing failed", () => {
		const { doc, mic } = fixture();
		expect(() =>
			attachRecordingAudio(doc, "/screen.mp4", [
				{ source: "microphone", asset: { ...mic, durationSec: undefined } },
			]),
		).toThrow();
		expect(doc.assets[0].sourceAudioMuted).toBeUndefined();
	});
});

describe("recording audio import failure", () => {
	beforeEach(() => useProjectStore.getState().clear());
	it("keeps the embedded mix if either source fails to import", async () => {
		const { doc, mic } = fixture();
		const save = vi.fn(async () => true);
		useProjectStore.setState({
			projectId: "p",
			document: doc,
			saveDocument: save,
			addAudioAsset: vi.fn().mockResolvedValueOnce(mic).mockResolvedValueOnce(null),
		});
		await expect(
			importRecordingAudioSources("/screen.mp4", [
				{ path: "/mic.wav", source: "microphone" },
				{ path: "/desktop.wav", source: "desktop" },
			]),
		).rejects.toThrow();
		expect(save).not.toHaveBeenCalled();
		expect(useProjectStore.getState().document?.assets[0].sourceAudioMuted).toBeUndefined();
	});
});
