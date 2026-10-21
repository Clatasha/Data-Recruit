import type { AxcutDocument } from "../schema";
import { anchorRegionsWithDerivedMs, coalesceRegionsForRuler } from "../timeline/timelineMap";
import { coalescedTrimGroups, ventilateTimelineSpanToTrims } from "../timeline/trim-mapping";
import { anchorAudioTrackFragments, collapseTracksToPills } from "./audioTracks";
import { createId } from "./ids";
import { readSpeedRegions } from "./timeline";

export type DuplicableTimelineKind =
	| "annotation"
	| "zoom"
	| "speed"
	| "trim"
	| "cameraFullscreen"
	| "audio";
/** Find a separate copy position without overlapping another item in the same lane. */
export function duplicatePlacement(
	start: number,
	end: number,
	occupied: Array<{ start: number; end: number }>,
	total: number,
): number | null {
	const duration = end - start;
	if (!(duration > 0) || duration > total) return null;
	const gap = 1 / 60;
	const candidates = [end + gap, 0, ...occupied.map((item) => item.end + gap)];
	for (const candidate of candidates) {
		if (candidate + duration > total + 1e-8) continue;
		if (
			occupied.every(
				(item) => candidate + duration <= item.start - gap || candidate >= item.end + gap,
			)
		)
			return candidate;
	}
	return null;
}
export function duplicateTimelineItem(
	doc: AxcutDocument,
	kind: DuplicableTimelineKind,
	id: string,
): AxcutDocument {
	if (kind === "audio") {
		const track = collapseTracksToPills(doc.audioTracks).find((track) => track.id === id);
		if (!track) return doc;
		// Independent audio layers may overlap; keep the exact source window and mix settings.
		const copy = {
			...track,
			id: createId("audio"),
			trackId: undefined,
			editorTrackId: createId("audio-track"),
			linkGroupId: undefined,
			origin: "user" as const,
		};
		return {
			...doc,
			audioTracks: [
				...doc.audioTracks,
				...anchorAudioTrackFragments(copy, doc.timeline.clips, () => createId("audio")),
			],
		};
	}
	const total = Math.max(0, ...doc.timeline.clips.map((clip) => clip.timelineEndSec));
	if (kind === "trim") {
		const groups = coalescedTrimGroups(doc.timeline.trimRanges, doc.timeline.clips);
		const group = groups.find((group) => group.ids.includes(id));
		if (!group) return doc;
		const at = duplicatePlacement(group.start, group.end, groups, total);
		if (at === null) return doc;
		const ranges = ventilateTimelineSpanToTrims(
			at,
			at + group.end - group.start,
			doc.timeline.clips,
		).map((range) => ({
			id: createId("trim"),
			assetId: range.assetId,
			clipId: range.clipId,
			startSec: range.sourceStartSec,
			endSec: range.sourceEndSec,
			reason: "manual",
			origin: "user" as const,
		}));
		return {
			...doc,
			timeline: { ...doc.timeline, trimRanges: [...doc.timeline.trimRanges, ...ranges] },
		};
	}

	if (kind === "annotation") {
		const group = coalesceRegionsForRuler(doc.annotations).find((p) => p.ids.includes(id));
		if (group?.member.type === "image") {
			const copy = {
				...group.member,
				id: createId("ann"),
				mediaLayerId: createId("media"),
				editorTrackId: createId("visual-track"),
				linkGroupId: undefined,
				startMs: Math.round(group.start * 1000),
				endMs: Math.round(group.end * 1000),
				zIndex: Math.max(0, ...doc.annotations.map((a) => a.zIndex)) + 1,
			};
			const anchored = anchorRegionsWithDerivedMs([copy], doc.timeline.clips, () =>
				createId("ann"),
			);
			return { ...doc, annotations: [...doc.annotations, ...anchored] };
		}
	}

	type Span = { id: string; startMs: number; endMs: number };
	const duplicateRanges = <T extends Span>(ranges: T[]): T[] | null => {
		const groups = coalesceRegionsForRuler(ranges);
		const group = groups.find((group) => group.ids.includes(id));
		if (!group) return null;
		const at = duplicatePlacement(group.start, group.end, groups, total);
		if (at === null) return null;
		const copy = {
			...group.member,
			id: createId(kind),
			startMs: Math.round(at * 1000),
			endMs: Math.round((at + group.end - group.start) * 1000),
		};
		// The anchorer preserves the complete payload and replaces only position/id/anchor fields.
		const anchored = anchorRegionsWithDerivedMs([copy], doc.timeline.clips, () =>
			createId(kind),
		) as unknown as T[];
		return [...ranges, ...anchored];
	};
	if (kind === "annotation") {
		const annotations = duplicateRanges(doc.annotations);
		return annotations ? { ...doc, annotations } : doc;
	}
	if (kind === "zoom") {
		const zoomRanges = duplicateRanges(doc.zoomRanges);
		return zoomRanges ? { ...doc, zoomRanges } : doc;
	}
	const legacy = (doc.legacyEditor as Record<string, unknown>) ?? {};
	const field = kind === "speed" ? "speedRegions" : "cameraFullscreenRegions";
	const ranges =
		kind === "speed"
			? readSpeedRegions<Span & { speed: number }>(doc)
			: ((legacy.cameraFullscreenRegions as Span[]) ?? []);
	const copied = duplicateRanges(ranges);
	return copied ? { ...doc, legacyEditor: { ...legacy, [field]: copied } } : doc;
}
