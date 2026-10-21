import { useScopedT } from "@/contexts/I18nContext";
import { type PreviewQuality, usePreviewPreferences } from "@/lib/ai-edition/previewPreferences";
import styles from "./v4/EditorShellV4.module.css";
export function PreviewQualitySelect() {
	const t = useScopedT("editor");
	const quality = usePreviewPreferences((s) => s.quality);
	return (
		<label className={styles.previewQuality} title={t("preview.exportUnaffected")}>
			<span>{t("preview.quality")}</span>
			<select
				aria-label={t("preview.quality")}
				value={quality}
				onChange={(e) =>
					usePreviewPreferences.getState().setQuality(e.target.value as PreviewQuality)
				}
			>
				{(["auto", "full", "half", "quarter"] as const).map((q) => (
					<option key={q} value={q}>
						{t(`preview.${q}`)}
					</option>
				))}
			</select>
		</label>
	);
}
