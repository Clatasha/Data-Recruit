import { useScopedT } from "@/contexts/I18nContext";
import { usePreviewPreferences, usePreviewProxies } from "@/lib/ai-edition/previewPreferences";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
export function PreviewPreparationStatus() {
	const t = useScopedT("editor");
	const enabled = usePreviewPreferences((s) => s.proxies);
	const jobs = usePreviewProxies((s) => s.jobs);
	const document = useProjectStore((s) => s.document);
	const pending = Object.entries(jobs).filter(
		([path, job]) =>
			(job.state === "generating" || job.state === "queued") &&
			document?.assets.some((a) => a.originalPath === path || a.cameraTrack?.sourcePath === path),
	);
	if (!enabled || !pending.length) return null;
	const active = pending.find(([, job]) => job.state === "generating") ?? pending[0];
	return (
		<output
			role="status"
			style={{
				position: "absolute",
				bottom: 10,
				left: 10,
				zIndex: 2,
				pointerEvents: "none",
				maxWidth: "70%",
				background: "rgba(15,23,42,.9)",
				color: "white",
				borderRadius: 8,
				padding: "7px 10px",
				fontSize: 12,
			}}
		>
			<div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
				{t(`preview.proxy.${active[1].state}`)} · {active[0].split(/[\\/]/).pop()}
			</div>
			<progress
				aria-label={t("preview.proxy.generating")}
				value={active[1].state === "generating" ? active[1].progress : undefined}
				max={100}
				style={{ width: "100%" }}
			/>
		</output>
	);
}
