import { BookmarkPlus, Camera, Mic, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useScopedT } from "@/contexts/I18nContext";
import { usePreviewMonitor } from "@/lib/ai-edition/previewMonitor";
import { usePreviewPlayback } from "@/lib/ai-edition/previewPlayback";
import styles from "./EditorShellV4.module.css";

/** Capture the composited picture, excluding editor handles and selection UI. */
export async function savePreviewScreenshot(): Promise<boolean> {
	const playback = usePreviewPlayback.getState();
	if (playback.nativeStatus !== "ready" || playback.buffering)
		throw new Error("Preview unavailable");
	const canvas = document.querySelector<HTMLCanvasElement>(
		'canvas[data-testid="native-compositor-mount"]',
	);
	if (!canvas?.width || !canvas.height) throw new Error("Preview unavailable");
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(value) => (value ? resolve(value) : reject(new Error("Preview unavailable"))),
			"image/png",
		),
	);
	if (!window.electronAPI?.savePreviewScreenshot) throw new Error("Saving unavailable");
	const result = await window.electronAPI.savePreviewScreenshot(await blob.arrayBuffer());
	if (result.canceled) return false;
	if (!result.success) throw new Error(result.message || "Saving failed");
	return true;
}
export function TimelineUtilities({
	onVoiceover,
	onMarker,
}: {
	onVoiceover: () => void;
	onMarker: () => void;
}) {
	const t = useScopedT("timeline");
	const { volume, muted, setVolume, setMuted } = usePreviewMonitor();
	const [saving, setSaving] = useState(false);
	return (
		<div className={styles.timelineUtilities}>
			<button
				type="button"
				className={styles.tlToolBtn}
				title={t("audio.addVoiceover")}
				aria-label={t("audio.addVoiceover")}
				onClick={onVoiceover}
			>
				<Mic size={16} />
			</button>
			<button
				type="button"
				className={styles.tlToolBtn}
				title={t("utilities.addMarker")}
				aria-label={t("utilities.addMarker")}
				onClick={onMarker}
			>
				<BookmarkPlus size={16} />
			</button>
			<button
				type="button"
				className={styles.tlToolBtn}
				title={t("utilities.screenshot")}
				aria-label={t("utilities.screenshot")}
				disabled={saving}
				onClick={() => {
					setSaving(true);
					void savePreviewScreenshot()
						.then((saved) => {
							if (saved) toast.success(t("utilities.screenshotSaved"));
						})
						.catch(() => toast.error(t("utilities.screenshotFailed")))
						.finally(() => setSaving(false));
				}}
			>
				<Camera size={16} />
			</button>
			<button
				type="button"
				className={styles.tlToolBtn}
				title={t("utilities.mutePreview")}
				aria-label={t("utilities.mutePreview")}
				aria-pressed={muted}
				onClick={() => setMuted(!muted)}
			>
				{muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
			</button>
			<input
				type="range"
				min={0}
				max={100}
				value={Math.round(volume * 100)}
				aria-label={t("utilities.previewVolume")}
				title={`${t("utilities.previewVolume")} ${Math.round(volume * 100)}%`}
				onChange={(e) => setVolume(Number(e.target.value) / 100)}
			/>
			<span className={styles.monitorPercent}>{Math.round(volume * 100)}%</span>
		</div>
	);
}
