import { useEffect } from "react";
import { usePreviewPreferences, usePreviewProxies } from "@/lib/ai-edition/previewPreferences";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { assetCameraSource } from "@/lib/ai-edition/timeline/camera";

/** Cache jobs are transient. Only the original paths belong to a saved project. */
export function usePreparePreviewProxies() {
	const document = useProjectStore((s) => s.document);
	const playing = useProjectStore((s) => s.playing);
	const enabled = usePreviewPreferences((s) => s.proxies);
	const cancelled = usePreviewProxies((s) => s.cancelled);
	const sources =
		document?.assets
			.filter((a) => a.kind === "video")
			.flatMap((a) => [
				{ path: a.originalPath, duration: a.durationSec ?? 0 },
				{ path: assetCameraSource(a).path, duration: a.durationSec ?? 0 },
			])
			.filter((a) => a.path && !/^(https?|blob|data):/.test(a.path)) ?? [];
	const key = JSON.stringify(sources);
	useEffect(() => {
		if (!enabled || cancelled || !window.electronAPI?.preparePreviewProxy) return;
		let disposed = false;
		let timer: ReturnType<typeof setTimeout>;
		const update = async () => {
			for (const source of JSON.parse(key) as typeof sources) {
				if (disposed) return;
				const result = await window.electronAPI
					.preparePreviewProxy?.(source.path, source.duration)
					.catch((error: unknown) => ({
						state: "error" as const,
						progress: 0,
						message: String(error),
					}));
				if (disposed || !result) return;
				usePreviewProxies.setState((s) => ({ jobs: { ...s.jobs, [source.path]: result } }));
			}
			if (!disposed) timer = setTimeout(() => void update(), 1000);
		};
		void update();
		return () => {
			disposed = true;
			clearTimeout(timer);
		};
	}, [enabled, cancelled, key]);
	const jobs = usePreviewProxies((s) => s.jobs);
	useEffect(() => {
		// Swap sources only at rest: never replace a decoder in mid-sentence.
		if (playing) return;
		const paths = enabled
			? Object.fromEntries(
					Object.entries(jobs).flatMap(([source, job]) =>
						job.state === "ready" && job.path ? [[source, job.path]] : [],
					),
				)
			: {};
		usePreviewProxies.setState((s) =>
			JSON.stringify(s.paths) === JSON.stringify(paths) ? s : { paths },
		);
	}, [enabled, jobs, playing]);
}
