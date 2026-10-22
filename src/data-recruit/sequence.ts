import type { Bookend } from "./bookends";
import { geometry, type ScrollSettings, scrollDuration } from "./model";
import { drawImageFit, drawScroll } from "./render";
import { sequenceFrame, transitionTransform } from "./transitions";

/** Shared preview/export composition. Effects occupy the bookend's tail/head, not extra timeline time. */
export function drawSequence(
	ctx: CanvasRenderingContext2D,
	cards: HTMLCanvasElement[],
	settings: ScrollSettings,
	time: number,
	intro: Bookend | null,
	outro: Bookend | null,
	drawBookend: (item: Bookend) => void = (item) =>
		drawImageFit(
			ctx,
			item.media,
			0,
			0,
			geometry(settings.format).width,
			geometry(settings.format).height,
			"fit",
		),
) {
	const { width, height } = geometry(settings.format);
	const frame = sequenceFrame(time, scrollDuration(cards.length, settings), intro, outro);
	const item = frame.slot === "intro" ? intro : frame.slot === "outro" ? outro : null;
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, width, height);
	ctx.clip();
	if (!item) drawScroll(ctx, cards, frame.scrollTime, settings);
	else if (
		!item.transition ||
		item.transition === "none" ||
		(frame.slot === "intro" && frame.progress <= 0) ||
		(frame.slot === "outro" && frame.progress >= 1)
	)
		drawBookend(item);
	else {
		ctx.fillStyle = "#111827";
		ctx.fillRect(0, 0, width, height);
		ctx.save();
		if (item.transition === "scroll") {
			const slide = transitionTransform(
				"scroll",
				frame.progress,
				frame.slot === "outro",
				width,
				height,
				settings.direction,
			);
			ctx.translate(slide.x, 0);
		}
		drawScroll(ctx, cards, frame.scrollTime, settings);
		ctx.restore();
		const transform = transitionTransform(
			item.transition,
			frame.progress,
			frame.slot === "intro",
			width,
			height,
			settings.direction,
		);
		ctx.save();
		ctx.globalAlpha = transform.alpha;
		ctx.translate(width / 2 + transform.x, height / 2 + transform.y);
		ctx.scale(transform.scaleX, transform.scaleY);
		ctx.translate(-width / 2, -height / 2);
		drawBookend(item);
		ctx.restore();
	}
	ctx.restore();
}
