import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { CropRegion } from "@/components/video-editor/types";
import { useScopedT } from "@/contexts/I18nContext";
import type { CreativeSettings } from "@/lib/ai-edition/creative/settings";
import { createEmptyDocument } from "@/lib/ai-edition/schema";
import {
	setCompositorPlaying,
	setCompositorScene,
	setCompositorTime,
} from "@/native/compositorViewClient";
import { useNativeCompositorView } from "@/native/hooks/useNativeCompositorView";
import { buildSceneDescription } from "@/native/sceneDescription";

/** Unsaved, source-only native view. It never writes the document or editor transport. */
export function CreativeClipPreview({
	path,
	settings,
	crop,
	aspect,
	startSec,
	endSec,
	playing,
	timeSec,
	seekTimeSec,
	videoRef,
}: {
	path: string;
	settings: CreativeSettings;
	crop: CropRegion;
	aspect: number;
	startSec: number;
	endSec: number;
	playing: boolean;
	timeSec: number;
	seekTimeSec: number;
	videoRef: RefObject<HTMLVideoElement>;
}) {
	const t = useScopedT("settings");
	const canvas = useRef<HTMLCanvasElement>(null);
	const { viewId, error } = useNativeCompositorView(canvas, {
		sources: { screenPath: path },
		isolated: true,
	});
	const [pushError, setPushError] = useState("");
	const time = useRef(timeSec);
	time.current = timeSec;
	const isPlaying = useRef(playing);
	isPlaying.current = playing;
	const end = useRef(endSec);
	end.current = endSec;
	const sceneJson = useMemo(() => {
		const doc = createEmptyDocument({ projectId: "clip-effect-preview", title: "Clip preview" });
		doc.assets = [
			{
				id: "source",
				kind: "video",
				originalPath: path,
				label: "Source",
				cameraTrack: null,
				video: { codec: "unknown", width: Math.round(aspect * 1080), height: 1080, fps: 30 },
				durationSec: endSec,
			},
		];
		doc.timeline.clips = [
			{
				id: "preview",
				assetId: "source",
				sourceStartSec: startSec,
				sourceEndSec: endSec,
				timelineStartSec: 0,
				timelineEndSec: endSec - startSec,
				origin: "user",
				reason: "",
				wordRefs: [],
				cropRegion: crop,
				creativeSettings: settings,
			},
		];
		doc.legacyEditor = {
			aspectRatio: "auto",
			padding: 0,
			frame: "none",
			shadowIntensity: 0,
			borderRadius: 0,
			webcamLayoutPreset: "no-webcam",
			cursorShow: false,
		};
		const scene = buildSceneDescription(doc);
		scene.cursor.show = false;
		return JSON.stringify(scene);
	}, [path, settings, crop, aspect, startSec, endSec]);
	// A slider change re-composes the current frame; no encoder or document save is involved.
	useEffect(() => {
		if (viewId === null) return;
		let disposed = false;
		void setCompositorScene(viewId, sceneJson)
			.then(() =>
				disposed || isPlaying.current
					? undefined
					: setCompositorTime(viewId, Math.max(startSec, Math.min(endSec - 0.001, time.current))),
			)
			.catch((cause: unknown) => {
				if (!disposed) setPushError(String(cause));
			});
		return () => {
			disposed = true;
		};
	}, [viewId, sceneJson, startSec, endSec]);
	useEffect(() => {
		if (viewId === null) return;
		void setCompositorTime(
			viewId,
			Math.max(
				startSec,
				Math.min(end.current - 0.001, videoRef.current?.currentTime ?? time.current),
			),
		)
			.then(() => setCompositorPlaying(viewId, playing))
			.catch((cause: unknown) => setPushError(String(cause)));
	}, [viewId, playing, videoRef, startSec]);
	useEffect(() => {
		if (viewId !== null)
			void setCompositorTime(
				viewId,
				Math.max(startSec, Math.min(end.current - 0.001, seekTimeSec)),
			).catch((cause: unknown) => setPushError(String(cause)));
	}, [viewId, seekTimeSec, startSec]);
	const outputAspect = (aspect * crop.width) / crop.height;
	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				display: "grid",
				placeItems: "center",
				background: "#000",
			}}
		>
			<canvas
				ref={canvas}
				aria-label={t("creative.livePreview")}
				style={{
					width: outputAspect >= aspect ? "100%" : "auto",
					height: outputAspect < aspect ? "100%" : "auto",
					maxWidth: "100%",
					maxHeight: "100%",
					aspectRatio: outputAspect,
				}}
			/>
			{error || pushError ? (
				<p role="alert" style={{ position: "absolute", padding: 12 }}>
					{error || pushError}
				</p>
			) : null}
		</div>
	);
}
