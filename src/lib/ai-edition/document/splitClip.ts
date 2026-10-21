import type { AxcutDocument } from "../schema";
import { getEditorSettings } from "../store/editorSettings";
import { createId } from "./ids";
import { fanOutAnchors } from "./insertion";
import { rederiveRegionMs } from "./timeline";

/** Split without deleting footage, moving later clips, or losing anchored audio/effects. */
export function splitClipAtPlayhead(
	doc: AxcutDocument,
	at: number,
	clipId?: string,
): AxcutDocument {
	if (!Number.isFinite(at)) return doc;
	const clip = doc.timeline.clips.find(
		(c) =>
			(!clipId || c.id === clipId) &&
			at > c.timelineStartSec + 0.001 &&
			at < c.timelineEndSec - 0.001,
	);
	if (!clip) return doc;
	const cut = clip.sourceStartSec + at - clip.timelineStartSec;
	const preset = clip.webcamLayoutPreset ?? getEditorSettings(doc).webcamLayoutPreset;
	const left = {
		...clip,
		sourceEndSec: cut,
		timelineEndSec: at,
		webcamLayoutPreset: preset,
		keepSeparate: true,
	};
	const right = {
		...clip,
		id: createId("clip"),
		sourceStartSec: cut,
		timelineStartSec: at,
		webcamLayoutPreset: preset,
		keepSeparate: true,
	};
	const next = {
		...doc,
		timeline: {
			...doc.timeline,
			clips: doc.timeline.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])),
		},
	};
	const anchored = fanOutAnchors(next, clip.id, right.id);
	return rederiveRegionMs(anchored, anchored.timeline.clips);
}
