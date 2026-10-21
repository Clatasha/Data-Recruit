import { anchorAudioTrackFragments } from "@/lib/ai-edition/document/audioTracks";
import { createId } from "@/lib/ai-edition/document/ids";
import { clipAwaitsProbedDuration, replaceTimeline } from "@/lib/ai-edition/document/timeline";
import { type AxcutAsset, type AxcutDocument, createAudioTrack } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { normalizeRecordedAudioSources, type RecordedAudioSource } from "@/lib/recordingSession";

/** Both sources commit together. Until then the video plays its embedded mix. */
export function attachRecordingAudio(
	document: AxcutDocument,
	screenPath: string,
	sources: Array<{ source: RecordedAudioSource["source"]; asset: AxcutAsset }>,
): AxcutDocument {
	const video = document.assets.find(
		(asset) => asset.originalPath === screenPath && asset.kind === "video",
	);
	if (!video || !sources.length || sources.some(({ asset }) => !asset.durationSec)) {
		throw new Error("Separate recording audio has no measurable duration");
	}
	let next = document;
	// A take longer than the provisional 60s clip must not lose its audio tail.
	const duration = Math.max(...sources.map(({ asset }) => asset.durationSec ?? 0));
	if (!video.durationSec)
		next = {
			...next,
			assets: next.assets.map((asset) =>
				asset.id === video.id ? { ...asset, durationSec: duration } : asset,
			),
		};
	const clip = next.timeline.clips[0];
	if (
		!clip ||
		(next.timeline.clips.length === 1 &&
			clip.assetId === video.id &&
			clipAwaitsProbedDuration(clip, video.id))
	) {
		next = replaceTimeline(next, [{ startSec: 0, endSec: duration }], "Recorded audio duration");
	}
	const tracks = sources.flatMap(({ source, asset }) => {
		const track = {
			...createAudioTrack({
				assetId: asset.id,
				durationSec: asset.durationSec ?? 0,
				kind: "voiceover",
				timelineStartSec: 0,
				label: source === "microphone" ? "Microphone" : "Desktop audio",
			}),
			recordingSource: source,
			origin: "system" as const,
		};
		// Independent sources intentionally overlap; the generic import placement
		// queues voiceovers sequentially, which would move the desktop after the mic.
		return anchorAudioTrackFragments(track, next.timeline.clips, () => createId("audio"));
	});
	return {
		...next,
		assets: next.assets.map((asset) =>
			asset.id === video.id ? { ...asset, sourceAudioMuted: true } : asset,
		),
		audioTracks: [...next.audioTracks, ...tracks],
	};
}

export async function importRecordingAudioSources(
	screenPath: string,
	raw: RecordedAudioSource[],
): Promise<void> {
	const sources = normalizeRecordedAudioSources(raw);
	if (!sources.length) return;
	const projectId = useProjectStore.getState().projectId;
	const imported: Array<{ source: RecordedAudioSource["source"]; asset: AxcutAsset }> = [];
	for (const source of sources) {
		const label = source.source === "microphone" ? "Microphone" : "Desktop audio";
		const asset = await useProjectStore.getState().addAudioAsset(source.path, label);
		if (!asset || useProjectStore.getState().projectId !== projectId)
			throw new Error("Recording import was interrupted");
		imported.push({ source: source.source, asset });
	}
	const store = useProjectStore.getState();
	if (!store.document || store.projectId !== projectId)
		throw new Error("Recording project was closed");
	if (
		!(await store.saveDocument(attachRecordingAudio(store.document, screenPath, imported), {
			history: false,
		}))
	) {
		throw new Error("Could not save separate recording audio");
	}
	store.setSelectedAudioTrackId(null);
}
