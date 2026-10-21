import { useScopedT } from "@/contexts/I18nContext";
import { useEditorSettings } from "@/lib/ai-edition/store/useEditorSettings";
import styles from "./NewEditorShell.module.css";

export function ShortsOutputControls() {
	const t = useScopedT("settings");
	const { settings, set, hasDocument } = useEditorSettings();
	return (
		<div style={{ margin: "8px 16px", display: "grid", gap: 10 }}>
			<button
				type="button"
				className={`${styles.btn} ${styles.btnSecondary}`}
				disabled={!hasDocument}
				aria-pressed={settings.shortsMode}
				onClick={() =>
					void set({
						aspectRatio: "9:16",
						shortsMode: true,
						webcamLayoutPreset: "vertical-stack",
						padding: 0,
						frame: "none",
						formatFollowCursor: false,
					})
				}
			>
				{t("shorts.preset")}
			</button>
			{settings.shortsMode && (
				<>
					<small>{t("shorts.help")}</small>
					{(["shortsScreenFit", "shortsCameraFit"] as const).map((key) => (
						<label key={key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
							{t(key === "shortsScreenFit" ? "shorts.source" : "shorts.camera")}
							<select
								className={styles.control}
								value={settings[key]}
								onChange={(event) => void set({ [key]: event.target.value as "fit" | "fill" })}
							>
								<option value="fit">{t("shorts.fit")}</option>
								<option value="fill">{t("shorts.fill")}</option>
							</select>
						</label>
					))}
					<button
						type="button"
						className={`${styles.btn} ${styles.btnSecondary}`}
						onClick={() => void set({ shortsMode: false })}
					>
						{t("shorts.standard")}
					</button>
				</>
			)}
		</div>
	);
}
