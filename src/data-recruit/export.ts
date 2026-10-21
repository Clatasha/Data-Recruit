import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";
import { geometry, type ScrollSettings, scrollDuration } from "./model";
import { drawImageFit, drawScroll } from "./render";

export interface Bookend {
	image: HTMLImageElement;
	url: string;
	name: string;
	duration: number;
}
export async function encodeScroll(
	cards: HTMLCanvasElement[],
	settings: ScrollSettings,
	intro: Bookend | null,
	outro: Bookend | null,
	progress: (value: number) => void,
	signal: AbortSignal,
): Promise<ArrayBuffer> {
	const { width, height } = geometry(settings.format);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas unavailable");
	const source = new CanvasSource(canvas, { codec: "avc", bitrate: 8_000_000 });
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
	output.addVideoTrack(source, { frameRate: 30 });
	const scroll = scrollDuration(cards.length, settings);
	const introDuration = intro?.duration ?? 0;
	const total = introDuration + scroll + (outro?.duration ?? 0);
	const frames = Math.ceil(total * 30);
	try {
		await output.start();
		for (let frame = 0; frame < frames; frame++) {
			if (signal.aborted) throw new Error("Build cancelled.");
			const time = frame / 30;
			if (intro && time < introDuration) drawImageFit(ctx, intro.image, 0, 0, width, height, "fit");
			else if (outro && time >= introDuration + scroll)
				drawImageFit(ctx, outro.image, 0, 0, width, height, "fit");
			else drawScroll(ctx, cards, time - introDuration, settings);
			await source.add(time, Math.min(1 / 30, total - time));
			if (frame % 15 === 0) {
				progress(frame / frames);
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		}
		source.close();
		await output.finalize();
		if (!target.buffer) throw new Error("The video encoder did not return a file.");
		progress(1);
		return target.buffer;
	} catch (error) {
		await output.cancel().catch(() => {
			/* Preserve the original encoder error if cancellation also fails. */
		});
		throw error;
	}
}
