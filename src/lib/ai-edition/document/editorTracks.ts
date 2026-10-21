import {
	type AxcutAnnotationRegion,
	type AxcutAudioTrack,
	type AxcutClip,
	type AxcutDocument,
	createAudioTrack,
} from "../schema";
import { anchorRegionsWithDerivedMs, coalesceRegionsForRuler } from "../timeline/timelineMap";
import { anchorAudioTrackFragments, collapseTracksToPills, trackGroupId } from "./audioTracks";
import { type DuplicableTimelineKind, duplicateTimelineItem } from "./duplicateTimelineItem";
import { createId } from "./ids";
import {
	duplicateClip,
	moveClip,
	rederiveRegionMs,
	removeClip,
	resequenceClips,
	withClipsChanged,
} from "./timeline";

export type EditorTrack = NonNullable<AxcutDocument["timeline"]["tracks"]>[number];
export type EditorItemRef = { kind: "clip" | "annotation" | "audio"; id: string };
export type EditorItem = AxcutClip | AxcutAnnotationRegion | AxcutAudioTrack;
export const MAIN_TRACK = "main-video";
export function groupId(item: EditorItem, kind: EditorItemRef["kind"]): string {
	if (kind === "audio") return trackGroupId(item as AxcutAudioTrack);
	if (kind === "annotation") return (item as AxcutAnnotationRegion).mediaLayerId ?? item.id;
	return item.id;
}
export function itemRows(doc: AxcutDocument, ref: EditorItemRef): EditorItem[] {
	const rows =
		ref.kind === "clip"
			? doc.timeline.clips
			: ref.kind === "audio"
				? doc.audioTracks
				: doc.annotations;
	const hit = rows.find((r) => r.id === ref.id || groupId(r, ref.kind) === ref.id);
	if (!hit) return [];
	if (ref.kind === "annotation" && !(hit as AxcutAnnotationRegion).mediaLayerId) {
		const group = coalesceRegionsForRuler(doc.annotations).find((pill) =>
			pill.ids.includes(hit.id),
		);
		const ids = new Set(group?.ids ?? [hit.id]);
		return doc.annotations.filter((row) => ids.has(row.id));
	}
	return rows.filter((r) => groupId(r, ref.kind) === groupId(hit, ref.kind));
}
export function itemTrackId(item: EditorItem, kind: EditorItemRef["kind"]): string {
	return item.editorTrackId ?? (kind === "clip" ? MAIN_TRACK : `${kind}:${groupId(item, kind)}`);
}
export function editorTracks(doc: AxcutDocument): EditorTrack[] {
	const tracks = [...(doc.timeline.tracks ?? [])];
	const add = (id: string, kind: EditorTrack["kind"], label: string) => {
		if (!doc.timeline.removedTrackIds?.includes(id) && !tracks.some((t) => t.id === id))
			tracks.push({
				id,
				kind,
				label,
				locked: false,
				hidden: false,
				muted: false,
				autoCreated: kind === "visual" || kind === "audio",
			});
	};
	for (const r of [...doc.annotations].sort((a, b) => b.zIndex - a.zIndex))
		add(
			itemTrackId(r, "annotation"),
			"visual",
			r.editorLabel ||
				doc.assets.find((a) => a.id === r.mediaAssetId)?.label ||
				(r.type === "image" ? "Images" : "Annotations"),
		);
	for (const r of collapseTracksToPills(doc.audioTracks))
		add(itemTrackId(r, "audio"), "audio", r.label || "Audio");
	if (!tracks.some((t) => t.kind === "visual")) add("visual-empty", "visual", "Visuals");
	if (!tracks.some((t) => t.kind === "audio")) add("audio-empty", "audio", "Audio");
	if (tracks.filter((t) => t.kind === "audio").length < 2) add("audio-empty-2", "audio", "Audio 2");
	add(MAIN_TRACK, "video", "Recording");
	for (const id of ["zoom", "speed", "trim", "cameraFullscreen"]) add(`effect:${id}`, "effect", id);
	const recordingAudio = ["desktop", "microphone"].flatMap((source) => {
		const row = doc.audioTracks.find(
			(item) => item.origin === "system" && item.recordingSource === source,
		);
		return row ? [itemTrackId(row, "audio")] : [];
	});
	if (
		!recordingAudio.some((id) =>
			doc.audioTracks.some(
				(row) => row.recordingSource === "desktop" && itemTrackId(row, "audio") === id,
			),
		) &&
		tracks.some((track) => track.id === "recording-desktop")
	)
		recordingAudio.unshift("recording-desktop");
	const pinned = [...new Set([MAIN_TRACK, ...recordingAudio])];
	return [
		...tracks.filter((track) => !pinned.includes(track.id) && track.id !== "effect:trim"),
		...tracks.filter((track) => track.id === "effect:trim"),
		...pinned.flatMap((id) => tracks.filter((track) => track.id === id)),
	];
}
export function trackForItem(doc: AxcutDocument, ref: EditorItemRef): EditorTrack | undefined {
	const row = itemRows(doc, ref)[0];
	return row ? editorTracks(doc).find((t) => t.id === itemTrackId(row, ref.kind)) : undefined;
}
export function isItemLocked(doc: AxcutDocument, ref: EditorItemRef): boolean {
	return trackForItem(doc, ref)?.locked ?? false;
}
export function isItemEnabled(
	doc: AxcutDocument,
	item: EditorItem,
	kind: EditorItemRef["kind"],
): boolean {
	return !item.disabled && !editorTracks(doc).find((t) => t.id === itemTrackId(item, kind))?.hidden;
}
export function patchEditorTrack(
	doc: AxcutDocument,
	id: string,
	patch: Partial<Omit<EditorTrack, "id" | "kind">>,
): AxcutDocument {
	return {
		...doc,
		timeline: {
			...doc.timeline,
			tracks: editorTracks(doc).map((t) => (t.id === id ? { ...t, ...patch } : t)),
		},
	};
}
export function patchEditorItem(
	doc: AxcutDocument,
	ref: EditorItemRef,
	patch: Partial<Pick<EditorItem, "disabled" | "editorTrackId" | "linkGroupId" | "editorLabel">>,
): AxcutDocument {
	if (isItemLocked(doc, ref)) return doc;
	const ids = new Set(itemRows(doc, ref).map((r) => r.id));
	if (ref.kind === "clip")
		return {
			...doc,
			timeline: {
				...doc.timeline,
				clips: doc.timeline.clips.map((r) => (ids.has(r.id) ? { ...r, ...patch } : r)),
			},
		};
	if (ref.kind === "annotation")
		return {
			...doc,
			annotations: doc.annotations.map((r) => (ids.has(r.id) ? { ...r, ...patch } : r)),
		};
	return {
		...doc,
		audioTracks: doc.audioTracks.map((r) => (ids.has(r.id) ? { ...r, ...patch } : r)),
	};
}
export function linkedItemRefs(doc: AxcutDocument, refs: EditorItemRef[]): EditorItemRef[] {
	const groups = new Set(
		refs.flatMap((r) => itemRows(doc, r).flatMap((i) => (i.linkGroupId ? [i.linkGroupId] : []))),
	);
	const all: EditorItemRef[] = [...refs];
	for (const kind of ["clip", "annotation", "audio"] as const) {
		const rows =
			kind === "clip" ? doc.timeline.clips : kind === "audio" ? doc.audioTracks : doc.annotations;
		for (const row of rows)
			if (row.linkGroupId && groups.has(row.linkGroupId))
				all.push({ kind, id: groupId(row, kind) });
	}
	const seen = new Set<string>();
	return all.flatMap((ref) => {
		const row = itemRows(doc, ref)[0];
		if (!row) return [];
		const id = groupId(row, ref.kind);
		const key = `${ref.kind}:${id}`;
		if (seen.has(key)) return [];
		seen.add(key);
		return [{ kind: ref.kind, id }];
	});
}
export function unlinkEditorItems(doc: AxcutDocument, ref: EditorItemRef): AxcutDocument {
	const refs = linkedItemRefs(doc, [ref]);
	if (refs.some((r) => isItemLocked(doc, r))) return doc;
	return refs.reduce((d, r) => patchEditorItem(d, r, { linkGroupId: undefined }), doc);
}
/** Clamp the group once, preserving spacing and synchronization. One document = one undo step. */
export function moveEditorItems(
	doc: AxcutDocument,
	refs: EditorItemRef[],
	deltaMs: number,
	targetTrackId?: string,
): AxcutDocument {
	if (!Number.isFinite(deltaMs)) return doc;
	const moving = linkedItemRefs(doc, refs);
	if (moving.some((r) => isItemLocked(doc, r))) return doc;
	const primaryRow = itemRows(doc, refs[0] ?? { kind: "clip", id: "" })[0];
	if (
		targetTrackId &&
		primaryRow &&
		"recordingSource" in primaryRow &&
		primaryRow.recordingSource &&
		primaryRow.origin === "system" &&
		targetTrackId !== itemTrackId(primaryRow, "audio")
	)
		return doc;
	const target = editorTracks(doc).find((t) => t.id === targetTrackId);
	if (target?.locked) return doc;
	const spans = moving.flatMap((ref) =>
		itemRows(doc, ref).map((r) =>
			ref.kind === "clip"
				? (r as AxcutClip).timelineStartSec * 1000
				: (r as AxcutAudioTrack).startMs,
		),
	);
	if (!spans.length) return doc;
	const end = Math.max(0, ...doc.timeline.clips.map((c) => c.timelineEndSec * 1000));
	const ends = moving.flatMap((ref) =>
		itemRows(doc, ref).map((r) =>
			ref.kind === "clip" ? (r as AxcutClip).timelineEndSec * 1000 : (r as AxcutAudioTrack).endMs,
		),
	);
	const delta = Math.max(-Math.min(...spans), Math.min(deltaMs, end - Math.max(...ends)));
	const main = moving.find((r) => r.kind === "clip");
	if (main) {
		const selected = new Set(moving.filter((ref) => ref.kind === "clip").map((ref) => ref.id));
		const positions = doc.timeline.clips.flatMap((clip, index) =>
			selected.has(clip.id) ? [index] : [],
		);
		if (positions.some((index, i) => i > 0 && index !== positions[i - 1] + 1)) return doc;
		const block = doc.timeline.clips
			.filter((clip) => selected.has(clip.id))
			.map((clip) => ({ ...clip, keepSeparate: true }));
		const remaining = resequenceClips(doc.timeline.clips.filter((clip) => !selected.has(clip.id)));
		const first = block[0];
		if (!first) return doc;
		const found = remaining.findIndex(
			(clip) =>
				(clip.timelineStartSec + clip.timelineEndSec) / 2 > first.timelineStartSec + delta / 1000,
		);
		const at = found < 0 ? remaining.length : found;
		const reordered = withClipsChanged(doc, [
			...remaining.slice(0, at),
			...block,
			...remaining.slice(at),
		]);
		const actual =
			((reordered.timeline.clips.find((clip) => clip.id === first.id)?.timelineStartSec ??
				first.timelineStartSec) -
				first.timelineStartSec) *
			1000;
		if (actual < -Math.min(...spans) || actual > end - Math.max(...ends)) return doc;
		const independent = moving.filter(
			(ref) =>
				ref.kind !== "clip" &&
				itemRows(doc, ref).some(
					(row) => !("clipId" in row) || !row.clipId || !selected.has(row.clipId),
				),
		);
		if (!independent.length) return reordered;
		const temporary = {
			...reordered,
			timeline: {
				...reordered.timeline,
				clips: reordered.timeline.clips.map((clip) =>
					selected.has(clip.id) ? { ...clip, linkGroupId: undefined } : clip,
				),
			},
		};
		const shifted = moveEditorItems(temporary, independent, actual);
		return { ...shifted, timeline: { ...shifted.timeline, clips: reordered.timeline.clips } };
	}
	const tracks = editorTracks(doc);
	const destination = new Map<string, string>();
	const primary = refs[0];
	if (
		target &&
		primary &&
		(primary.kind === "audio"
			? target.kind === "audio"
			: primary.kind === "annotation" && target.kind === "visual")
	) {
		const source = itemRows(doc, primary)[0];
		if (source) {
			destination.set(itemTrackId(source, primary.kind), target.id);
			const companions = moving.filter(
				(ref) =>
					ref.kind !== primary.kind &&
					itemRows(doc, ref)[0]?.linkGroupId === source.linkGroupId &&
					!!source.linkGroupId,
			);
			for (const companion of companions) {
				const row = itemRows(doc, companion)[0];
				if (!row) continue;
				const kind = companion.kind === "audio" ? "audio" : "visual";
				const index =
					tracks.findIndex((track) => track.id === target.id) + (kind === "audio" ? 1 : -1);
				let neighbor = tracks[index];
				if (!neighbor || neighbor.kind !== kind || neighbor.locked) {
					neighbor = {
						id: createId(`${kind}-track`),
						autoCreated: true,
						kind,
						label: row.editorLabel || ("label" in row ? row.label : target.label) || target.label,
						locked: false,
						hidden: false,
						muted: false,
					};
					tracks.splice(Math.max(0, kind === "audio" ? index : index + 1), 0, neighbor);
				}
				destination.set(itemTrackId(row, companion.kind), neighbor.id);
			}
		}
	}
	let next = destination.size ? { ...doc, timeline: { ...doc.timeline, tracks } } : doc;
	for (const ref of moving) {
		if (ref.kind === "clip") continue;
		const rows = itemRows(doc, ref);
		const ids = new Set(rows.map((r) => r.id));
		const trackId = rows[0]
			? (destination.get(itemTrackId(rows[0], ref.kind)) ?? rows[0].editorTrackId)
			: undefined;
		if (ref.kind === "audio") {
			const track = collapseTracksToPills(rows as AxcutAudioTrack[])[0];
			if (!track) continue;
			const fragments = anchorAudioTrackFragments(
				{
					...track,
					clipId: undefined,
					sourceStartSec: undefined,
					sourceEndSec: undefined,
					startMs: track.startMs + delta,
					endMs: track.endMs + delta,
					editorTrackId: trackId,
				},
				doc.timeline.clips,
				() => createId("audio"),
			);
			next = {
				...next,
				audioTracks: [...next.audioTracks.filter((r) => !ids.has(r.id)), ...fragments],
			};
		} else {
			const ordered = [...(rows as AxcutAnnotationRegion[])].sort((a, b) => a.startMs - b.startMs);
			const first = ordered[0];
			if (!first) continue;
			const whole = {
				...first,
				clipId: undefined,
				assetId: undefined,
				sourceStartSec: undefined,
				sourceEndSec: undefined,
				startMs: first.startMs + delta,
				endMs: Math.max(...ordered.map((r) => r.endMs)) + delta,
				mediaOffsetMs: first.mediaOffsetMs === undefined ? undefined : first.mediaOffsetMs + delta,
				editorTrackId: trackId,
			};
			const fragments = anchorRegionsWithDerivedMs([whole], doc.timeline.clips, () =>
				createId("ann"),
			);
			next = {
				...next,
				annotations: [...next.annotations.filter((r) => !ids.has(r.id)), ...fragments],
			};
		}
	}
	return next;
}
/** Existing footage reorder carries clip-anchored sound; independent linked sound follows too. */
export function moveLinkedClip(doc: AxcutDocument, id: string, toIndex: number): AxcutDocument {
	const ref: EditorItemRef = { kind: "clip", id };
	if (linkedItemRefs(doc, [ref]).some((r) => isItemLocked(doc, r))) return doc;
	const before = doc.timeline.clips.find((c) => c.id === id);
	if (!before) return doc;
	const next = moveClip(doc, id, toIndex);
	const after = next.timeline.clips.find((c) => c.id === id);
	if (!after) return next;
	const delta = (after.timelineStartSec - before.timelineStartSec) * 1000;
	const linked = linkedItemRefs(doc, [ref]).filter((r) => r.kind !== "clip");
	// Anchored fragments already follow the clip through withClipsChanged.
	return linked.reduce((result, r) => {
		const oldRows = itemRows(doc, r);
		if (oldRows.every((row) => "clipId" in row && row.clipId)) return result;
		const ids = new Set(oldRows.map((row) => row.id));
		const shift = <T extends AxcutAudioTrack | AxcutAnnotationRegion>(row: T): T =>
			ids.has(row.id) ? { ...row, startMs: row.startMs + delta, endMs: row.endMs + delta } : row;
		return {
			...result,
			audioTracks: result.audioTracks.map(shift),
			annotations: result.annotations.map(shift),
		};
	}, next);
}
export function visibleEditorDocument(doc: AxcutDocument): AxcutDocument {
	const tracks = editorTracks(doc);
	const effectVisible = (kind: string) => !tracks.find((t) => t.id === `effect:${kind}`)?.hidden;
	return {
		...doc,
		annotations: doc.annotations
			.filter((r) => isItemEnabled(doc, r, "annotation"))
			.map((row) =>
				doc.timeline.tracks
					? {
							...row,
							zIndex:
								(tracks.length -
									tracks.findIndex((track) => track.id === itemTrackId(row, "annotation"))) *
									10000 +
								Math.max(0, Math.min(9999, row.zIndex)),
						}
					: row,
			),
		audioTracks: doc.audioTracks.filter(
			(r) =>
				isItemEnabled(doc, r, "audio") &&
				!tracks.find((t) => t.id === itemTrackId(r, "audio"))?.muted,
		),
		zoomRanges: effectVisible("zoom") ? doc.zoomRanges : [],
		timeline: { ...doc.timeline, trimRanges: effectVisible("trim") ? doc.timeline.trimRanges : [] },
		legacyEditor: {
			...doc.legacyEditor,
			...(!effectVisible("speed") ? { speedRegions: [] } : {}),
			...(!effectVisible("cameraFullscreen") ? { cameraFullscreenRegions: [] } : {}),
		},
	};
}

export function linkEditorItems(doc: AxcutDocument, refs: EditorItemRef[]): AxcutDocument {
	const all = linkedItemRefs(doc, refs);
	if (all.length < 2 || all.some((ref) => isItemLocked(doc, ref))) return doc;
	const linkGroupId = createId("link");
	return all.reduce((next, ref) => patchEditorItem(next, ref, { linkGroupId }), doc);
}
/** One locked lane protects its contents from every user edit, including shortcuts. */
export function changesLockedTracks(before: AxcutDocument, after: AxcutDocument): boolean {
	const tracks = (before.timeline.tracks ?? []).filter((track) => track.locked);
	for (const track of tracks) {
		if (track.kind === "effect") {
			const kind = track.id.slice(7);
			const values = (doc: AxcutDocument) =>
				kind === "zoom"
					? doc.zoomRanges
					: kind === "trim"
						? doc.timeline.trimRanges
						: doc.legacyEditor?.[kind === "speed" ? "speedRegions" : "cameraFullscreenRegions"];
			if (JSON.stringify(values(before)) !== JSON.stringify(values(after))) return true;
		} else {
			for (const kind of ["clip", "annotation", "audio"] as const) {
				const rows = (doc: AxcutDocument) =>
					(kind === "clip"
						? doc.timeline.clips
						: kind === "audio"
							? doc.audioTracks
							: doc.annotations
					).filter((row) => itemTrackId(row, kind) === track.id);
				if (JSON.stringify(rows(before)) !== JSON.stringify(rows(after))) return true;
			}
		}
	}
	return false;
}

export function attachClipAudio(
	doc: AxcutDocument,
	clipId: string,
	audioAssetId: string,
): AxcutDocument {
	const clip = doc.timeline.clips.find((item) => item.id === clipId);
	if (!clip || clip.embeddedAudioMuted || isItemLocked(doc, { kind: "clip", id: clipId }))
		return doc;
	const asset = doc.assets.find((item) => item.id === audioAssetId);
	if (!asset || asset.kind !== "audio") return doc;
	const linkGroupId = clip.linkGroupId ?? createId("link");
	const desktop = doc.audioTracks.find(
		(row) => row.origin === "system" && row.recordingSource === "desktop",
	);
	const trackId = desktop ? itemTrackId(desktop, "audio") : "recording-desktop";
	const audio = {
		...createAudioTrack({
			assetId: audioAssetId,
			durationSec: asset.durationSec ?? clip.sourceEndSec ?? 0,
			kind: "voiceover",
			timelineStartSec: clip.timelineStartSec,
			spanSec: clip.timelineEndSec - clip.timelineStartSec,
			label: asset.label,
		}),
		offsetMs: clip.sourceStartSec * 1000,
		recordingSource: "desktop" as const,
		editorTrackId: trackId,
		linkGroupId,
	};
	const tracks = editorTracks(doc);
	if (!tracks.some((track) => track.id === trackId))
		tracks.push({
			id: trackId,
			kind: "audio",
			label: "Desktop Audio",
			locked: false,
			hidden: false,
			muted: false,
			autoCreated: false,
		});
	return {
		...doc,
		timeline: {
			...doc.timeline,
			tracks,
			clips: doc.timeline.clips.map((item) =>
				item.id === clipId ? { ...item, embeddedAudioMuted: true, linkGroupId } : item,
			),
		},
		audioTracks: [
			...doc.audioTracks,
			...anchorAudioTrackFragments(audio, doc.timeline.clips, () => createId("audio")),
		],
	};
}

export function duplicateLinkedClip(
	doc: AxcutDocument,
	id: string,
	origin: "system" | "agent" | "user" = "user",
	reason = "",
): AxcutDocument {
	const original = doc.timeline.clips.find((clip) => clip.id === id);
	if (
		!original ||
		linkedItemRefs(doc, [{ kind: "clip", id }]).some((ref) => isItemLocked(doc, ref))
	)
		return doc;
	const next = duplicateClip(doc, id, origin, reason);
	const copy = next.timeline.clips.find(
		(clip) => !doc.timeline.clips.some((old) => old.id === clip.id),
	);
	if (!copy) return doc;
	const linkGroupId = original.linkGroupId ? createId("link") : undefined;
	const groups = new Map<string, string>();
	const sound = doc.audioTracks
		.filter(
			(track) =>
				track.clipId === id && track.linkGroupId === original.linkGroupId && !!original.linkGroupId,
		)
		.map((track) => {
			const old = trackGroupId(track);
			let group = groups.get(old);
			if (!group) {
				group = createId("audio");
				groups.set(old, group);
			}
			return { ...track, id: createId("audio"), trackId: group, clipId: copy.id, linkGroupId };
		});
	const annotations = next.annotations.map((row) =>
		doc.annotations.some((old) => old.id === row.id)
			? row
			: {
					...row,
					mediaLayerId: row.mediaLayerId ? createId("media") : undefined,
					linkGroupId: row.linkGroupId ? linkGroupId : undefined,
				},
	);
	return rederiveRegionMs(
		{
			...next,
			annotations,
			audioTracks: [...next.audioTracks, ...sound],
			timeline: {
				...next.timeline,
				clips: next.timeline.clips.map((clip) =>
					clip.id === copy.id ? { ...clip, linkGroupId } : clip,
				),
			},
		},
		next.timeline.clips,
	);
}
export function duplicateLinkedItem(
	doc: AxcutDocument,
	kind: DuplicableTimelineKind,
	id: string,
): AxcutDocument {
	if (kind !== "audio" && kind !== "annotation") return duplicateTimelineItem(doc, kind, id);
	const refs = linkedItemRefs(doc, [{ kind, id }]);
	if (refs.some((ref) => isItemLocked(doc, ref))) return doc;
	if (refs.some((ref) => ref.kind === "clip"))
		return duplicateLinkedClip(doc, refs.find((ref) => ref.kind === "clip")!.id);
	let next = doc;
	for (const ref of refs)
		if (ref.kind !== "clip")
			next = duplicateTimelineItem(
				next,
				ref.kind,
				ref.kind === "annotation" ? (itemRows(doc, ref)[0]?.id ?? ref.id) : ref.id,
			);
	const linkGroupId = refs.length > 1 ? createId("link") : undefined;
	return {
		...next,
		annotations: next.annotations.map((row) =>
			doc.annotations.some((old) => old.id === row.id) ? row : { ...row, linkGroupId },
		),
		audioTracks: next.audioTracks.map((row) =>
			doc.audioTracks.some((old) => old.id === row.id) ? row : { ...row, linkGroupId },
		),
	};
}
/** Replace file metadata while retaining every timeline reference and edited source window. */
export function relinkEditorAsset(
	doc: AxcutDocument,
	id: string,
	replacement: AxcutDocument["assets"][number],
): AxcutDocument {
	const old = doc.assets.find((asset) => asset.id === id);
	if (!old) return doc;
	if (old.kind !== replacement.kind || !!old.stillImagePath !== !!replacement.stillImagePath)
		throw new Error("Choose the same media type for the replacement");
	const clipEnd = doc.timeline.clips
		.filter((clip) => clip.assetId === id)
		.map((clip) => clip.sourceEndSec ?? 0);
	const overlayEnd = doc.annotations
		.filter((row) => row.mediaAssetId === id)
		.map((row) => (row.mediaSourceStartSec ?? 0) + (row.endMs - row.startMs) / 1000);
	const audioEnd = doc.audioTracks
		.filter((row) => row.assetId === id && !row.loop)
		.map((row) => (row.offsetMs + row.endMs - row.startMs) / 1000);
	if (
		replacement.durationSec !== undefined &&
		replacement.durationSec + 0.01 < Math.max(0, ...clipEnd, ...overlayEnd, ...audioEnd)
	)
		throw new Error("The replacement is shorter than the edited source window");
	return {
		...doc,
		assets: doc.assets
			.filter((asset) => asset.id !== replacement.id || asset.id === id)
			.map((asset) =>
				asset.id === id
					? {
							...asset,
							...replacement,
							id,
							label: asset.label,
							libraryCategory: asset.libraryCategory,
							cameraTrack: asset.cameraTrack,
							sourceAudioMuted: asset.sourceAudioMuted,
						}
					: asset.kind === "audio" && asset.originalPath === old.originalPath
						? {
								...asset,
								originalPath: replacement.originalPath,
								proxyPath: undefined,
								waveformPath: undefined,
							}
						: asset,
			),
	};
}

export function removeLinkedEditorItems(doc: AxcutDocument, ref: EditorItemRef): AxcutDocument {
	const refs = linkedItemRefs(doc, [ref]);
	if (refs.some((item) => isItemLocked(doc, item))) return doc;
	let next = doc;
	for (const item of refs) {
		const ids = new Set(itemRows(doc, item).map((row) => row.id));
		if (item.kind === "annotation")
			next = { ...next, annotations: next.annotations.filter((row) => !ids.has(row.id)) };
		if (item.kind === "audio")
			next = { ...next, audioTracks: next.audioTracks.filter((row) => !ids.has(row.id)) };
	}
	for (const item of refs)
		if (item.kind === "clip" && next.timeline.clips.some((clip) => clip.id === item.id))
			next = removeClip(next, item.id);
	return pruneEmptyAutomaticTracks(doc, { ...next, assets: doc.assets });
}

/** Retain deliberate empty lanes; remove media lanes vacated by deletion or movement. */
export function pruneEmptyAutomaticTracks(
	before: AxcutDocument,
	after: AxcutDocument,
): AxcutDocument {
	if (!after.timeline.tracks) return after;
	const occupied = (doc: AxcutDocument) =>
		new Set([
			...doc.annotations.map((row) => itemTrackId(row, "annotation")),
			...doc.audioTracks.map((row) => itemTrackId(row, "audio")),
		]);
	const wasOccupied = occupied(before),
		nowOccupied = occupied(after);
	const tracks = after.timeline.tracks.filter(
		(track) =>
			track.kind === "video" ||
			track.kind === "effect" ||
			track.autoCreated === false ||
			!wasOccupied.has(track.id) ||
			nowOccupied.has(track.id),
	);
	return tracks.length === after.timeline.tracks.length
		? after
		: { ...after, timeline: { ...after.timeline, tracks } };
}

/** User lanes can be removed with their contents; original capture and locked lanes stay protected. */
export function editorTrackItems(doc: AxcutDocument, id: string): EditorItemRef[] {
	return [
		...doc.annotations
			.filter((row) => itemTrackId(row, "annotation") === id)
			.map((row) => ({ kind: "annotation" as const, id: row.id })),
		...doc.audioTracks
			.filter((row) => itemTrackId(row, "audio") === id)
			.map((row) => ({ kind: "audio" as const, id: row.id })),
	];
}
export function canRemoveEditorTrack(doc: AxcutDocument, id: string): boolean {
	const track = editorTracks(doc).find((row) => row.id === id);
	const refs = linkedItemRefs(doc, editorTrackItems(doc, id));
	return (
		!!track &&
		(track.kind === "visual" || track.kind === "audio") &&
		!track.locked &&
		id !== "recording-desktop" &&
		!refs.some(
			(ref) =>
				ref.kind === "clip" ||
				isItemLocked(doc, ref) ||
				itemRows(doc, ref).some(
					(row) => "recordingSource" in row && row.recordingSource && row.origin === "system",
				),
		)
	);
}
export function removeEditorTrack(doc: AxcutDocument, id: string): AxcutDocument {
	if (!canRemoveEditorTrack(doc, id)) return doc;
	const refs = editorTrackItems(doc, id);
	const next = refs.reduce((current, ref) => removeLinkedEditorItems(current, ref), doc);
	return {
		...next,
		timeline: {
			...next.timeline,
			tracks: editorTracks(next).filter((row) => row.id !== id),
			removedTrackIds: [...new Set([...(next.timeline.removedTrackIds ?? []), id])],
		},
	};
}
/** Remove only the Library entry. Timeline instances keep their source; undo restores the entry. */
export function removeLibraryAsset(doc: AxcutDocument, id: string): AxcutDocument {
	if (!doc.assets.some((asset) => asset.id === id && !asset.libraryHidden)) return doc;
	return {
		...doc,
		assets: doc.assets.map((asset) =>
			asset.id === id ? { ...asset, libraryHidden: true } : asset,
		),
	};
}
