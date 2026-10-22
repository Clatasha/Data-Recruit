import { openBookendInput } from "./mediaSource";

/** Keep audio on the original input; only unsupported video needs a temporary software proxy. */
export async function openExportVideo(
	url: string,
	start: number,
	duration: number,
	signal: AbortSignal,
) {
	const input = await openBookendInput(url);
	let videoInput = input,
		proxy: string | null = null;
	const dispose = async () => {
		videoInput.dispose();
		if (videoInput !== input) input.dispose();
		if (proxy) {
			const id = proxy.slice("data-recruit-media:".length);
			proxy = null;
			await window.electronAPI?.dataRecruitReleaseVideoProxy?.(id);
		}
	};
	try {
		let track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error("No video track in the intro/outro.");
		const first = await track.getFirstTimestamp();
		let videoStart = start;
		if (!(await track.canDecode())) {
			const api = window.electronAPI;
			if (!url.startsWith("data-recruit-media:") || !api?.dataRecruitVideoProxy)
				throw new Error(
					"This browser cannot decode the intro/outro. Add the video again using the desktop picker.",
				);
			const job = crypto.randomUUID();
			const abort = () => {
				void api.dataRecruitCancelBookendAudio?.(job);
			};
			signal.throwIfAborted();
			signal.addEventListener("abort", abort, { once: true });
			try {
				proxy = await api.dataRecruitVideoProxy(
					url.slice("data-recruit-media:".length),
					start,
					duration,
					job,
				);
			} finally {
				signal.removeEventListener("abort", abort);
			}
			signal.throwIfAborted();
			videoInput = await openBookendInput(proxy);
			track = await videoInput.getPrimaryVideoTrack();
			if (!track || !(await track.canDecode()))
				throw new Error("The prepared intro/outro video cannot be decoded.");
			videoStart = 0;
		}
		return {
			input,
			track,
			first,
			videoFirst: await track.getFirstTimestamp(),
			videoStart,
			dispose,
		};
	} catch (error) {
		await dispose().catch(() => {
			/* Keep the original error. */
		});
		throw error;
	}
}
