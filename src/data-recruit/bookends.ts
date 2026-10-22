import type { Transition } from "./transitions";
export type Bookend = {
	name: string;
	url: string;
	duration: number;
	transition?: Transition;
	transitionSeconds?: number;
} & (
	| { kind: "image"; media: HTMLImageElement }
	| {
			kind: "video";
			media: HTMLVideoElement;
			sourceDuration: number;
			muted: boolean;
			start?: number;
			volume?: number;
	  }
);

export const loadImage = (url: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Could not decode the image. Use PNG, JPEG or WebP."));
		image.src = url;
	});

export async function loadBookend(
	name: string,
	url: string,
	kind: "image" | "video",
	duration?: number,
	muted = false,
	start = 0,
	volume = 1,
): Promise<Bookend> {
	const previewUrl = url.startsWith("data-recruit-media:")
		? (await window.electronAPI?.dataRecruitBookendInfo?.(url.slice("data-recruit-media:".length)))
				?.url
		: url;
	if (!previewUrl)
		throw new Error(
			"Open this project in Data Recruit on the computer where its media was imported.",
		);
	if (kind === "image")
		return {
			kind,
			name,
			url,
			media: await loadImage(previewUrl),
			duration: Math.max(0.1, Math.min(30, duration ?? 3)),
		};
	const media = document.createElement("video");
	media.preload = "auto";
	media.playsInline = true;
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => finish(new Error(`Could not load ${name}. Try an MP4 with H.264 video and AAC audio.`)),
			20_000,
		);
		const finish = (error?: Error) => {
			clearTimeout(timer);
			media.onloadeddata = null;
			media.onerror = null;
			error ? reject(error) : resolve();
		};
		media.onloadeddata = () =>
			Number.isFinite(media.duration) && media.duration > 0
				? finish()
				: finish(new Error("This video has no readable duration."));
		media.onerror = () =>
			finish(new Error(`Cannot play ${name}. Try an MP4 with H.264 video and AAC audio.`));
		media.src = previewUrl;
	});
	start = Math.max(0, Math.min(media.duration - 0.1, start));
	return {
		start,
		volume,
		kind,
		name,
		url,
		media,
		sourceDuration: media.duration,
		duration: Math.max(0.1, Math.min(media.duration - start, duration ?? media.duration)),
		muted,
	};
}

export function serializeBookend(item: Bookend | null) {
	return item
		? {
				kind: item.kind,
				name: item.name,
				url: item.url,
				duration: item.duration,
				transition: item.transition ?? "none",
				transitionSeconds: item.transitionSeconds ?? 0.75,
				start: item.kind === "video" ? (item.start ?? 0) : 0,
				volume: item.kind === "video" ? (item.volume ?? 1) : 1,
				muted: item.kind === "video" ? item.muted : false,
			}
		: null;
}

export function pauseBookends(...items: (Bookend | null)[]) {
	for (const item of items) if (item?.kind === "video") item.media.pause();
}
