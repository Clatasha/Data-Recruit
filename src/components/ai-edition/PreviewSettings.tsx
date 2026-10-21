import { useScopedT } from "@/contexts/I18nContext";
import { usePreviewPreferences, usePreviewProxies } from "@/lib/ai-edition/previewPreferences";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import styles from "./v4/EditorShellV4.module.css";
export function PreviewSettings() {
	const t = useScopedT("editor");
	const prefs = usePreviewPreferences();
	const jobs = usePreviewProxies((s) => s.jobs);
	const cancelled = usePreviewProxies((s) => s.cancelled);
	const document = useProjectStore((s) => s.document);
	const entries = Object.entries(jobs).filter(([path]) =>
		document?.assets.some((a) => a.originalPath === path || a.cameraTrack?.sourcePath === path),
	);
	const pending = entries.filter(([, job]) => job.state === "queued" || job.state === "generating");
	return (
		<div style={{ display: "grid", gap: 8, padding: "8px 12px" }}>
			<label>
				<input
					type="checkbox"
					checked={prefs.proxies}
					onChange={(e) => {
						prefs.setProxies(e.target.checked);
						if (e.target.checked) usePreviewProxies.getState().retry();
						else void window.electronAPI?.cancelPreviewProxies?.();
					}}
				/>{" "}
				{t("preview.useProxies")}
			</label>
			<small>{t("preview.exportUnaffected")}</small>
			{prefs.proxies &&
				entries.map(([path, job]) => (
					<div key={path} style={{ fontSize: 12 }}>
						<div style={{ overflowWrap: "anywhere" }}>
							{path.split(/[\\/]/).pop()} · {t(`preview.proxy.${job.state}`)}{" "}
							{job.state === "generating" ? `${Math.round(job.progress)}%` : ""}
						</div>
						{job.state === "generating" && (
							<progress
								aria-label={path}
								value={job.progress}
								max={100}
								style={{ width: "100%" }}
							/>
						)}
						{job.state === "error" && (
							<small title={job.message}>{t("preview.proxy.fallback")}</small>
						)}
					</div>
				))}
			{pending.length > 0 && (
				<button
					type="button"
					className={styles.appMenuRow}
					onClick={() => {
						usePreviewProxies.setState((s) => ({
							cancelled: true,
							jobs: Object.fromEntries(
								Object.entries(s.jobs).map(([path, job]) => [
									path,
									job.state === "queued" || job.state === "generating"
										? { ...job, state: "cancelled" as const }
										: job,
								]),
							),
						}));
						void window.electronAPI?.cancelPreviewProxies?.();
					}}
				>
					{t("preview.proxy.cancel")}
				</button>
			)}
			{prefs.proxies && (cancelled || entries.some(([, j]) => j.state === "error")) && (
				<button
					type="button"
					className={styles.appMenuRow}
					onClick={async () => {
						await window.electronAPI?.cancelPreviewProxies?.();
						usePreviewProxies.getState().retry();
					}}
				>
					{t("preview.proxy.retry")}
				</button>
			)}
		</div>
	);
}
