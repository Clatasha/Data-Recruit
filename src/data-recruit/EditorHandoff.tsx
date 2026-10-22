import { useEffect } from "react";
import { usePreviewPlayback } from "@/lib/ai-edition/previewPlayback";
export function EditorHandoff({
	poster,
	onReady,
	onBack,
}: {
	poster?: string;
	onReady: () => void;
	onBack: () => void;
}) {
	const status = usePreviewPlayback((state) => state.nativeStatus);
	useEffect(() => {
		if (status !== "ready" && status !== "error") return;
		const frame = requestAnimationFrame(onReady);
		return () => cancelAnimationFrame(frame);
	}, [status, onReady]);
	return (
		<div className="dr-handoff" role="status" aria-label="Opening editor">
			{poster && <img src={poster} alt="First frame of your video" />}
			<strong>Opening your timeline…</strong>
			<span>Preparing the video preview</span>
			<button type="button" onClick={onReady}>
				Show editor
			</button>
			<button type="button" onClick={onBack}>
				Return to builder
			</button>
		</div>
	);
}
