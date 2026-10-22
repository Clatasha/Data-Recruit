import type { Bookend } from "./bookends";
import { geometry, type ScrollSettings } from "./model";
import { drawImageFit, drawScroll } from "./render";
import { outroTransition, sequenceFrame, transitionTransform } from "./transitions";

/** One strip position drives card edges and both bookends in preview and export. */
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
	if (!intro && !outro) {
		drawScroll(ctx, cards, time, settings);
		return;
	}
	const { width, height, cardWidth } = geometry(settings.format);
	const frame = sequenceFrame(time, cards.length, settings, intro, outro);
	const mirror = settings.direction === "right";
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, width, height);
	ctx.clip();
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, width, height);
	cards.forEach((card, index) => {
		const left = frame.firstX + index * cardWidth;
		const x = mirror ? width - left - cardWidth : left;
		if (x < width && x + cardWidth > 0) ctx.drawImage(card, x, 0);
	});
	function bookend(item: Bookend, outgoing: boolean) {
		const p = outgoing ? frame.introProgress : frame.outroProgress;
		const style = outgoing ? (item.transition ?? "none") : outroTransition(item.transition);
		const transform = transitionTransform(style, p, outgoing, width, height, settings.direction);
		ctx.save();
		if (style === "scroll") {
			// Derive both positions from the very same card edge, without easing.
			const left = outgoing ? frame.firstX - width : frame.firstX + cards.length * cardWidth;
			ctx.translate(mirror ? -left : left, 0);
		} else if (style === "squeeze") {
			// Anchor to the exit edge so the incoming card presses the opposite edge.
			ctx.translate(mirror ? width * (1 - transform.scaleX) : 0, 0);
			ctx.scale(transform.scaleX, 1);
		} else ctx.translate(transform.x, transform.y);
		ctx.globalAlpha = transform.alpha;
		drawBookend(item);
		ctx.restore();
		if (style === "squeeze" && p > 0.9) {
			// A short burst at the compressed screen edge, clipped to the viewport.
			const burst = (p - 0.9) / 0.1;
			ctx.save();
			ctx.globalAlpha = Math.sin(burst * Math.PI);
			ctx.strokeStyle = "#ffffff";
			ctx.lineWidth = 4;
			const edge = mirror ? width : 0;
			for (let index = 0; index < 16; index++) {
				const y = ((index + 0.5) / 16) * height;
				ctx.beginPath();
				ctx.moveTo(edge, y);
				ctx.lineTo(
					edge + (mirror ? -1 : 1) * width * 0.08 * burst,
					y + Math.sin(index * 2.4) * height * 0.06 * burst,
				);
				ctx.stroke();
			}
			ctx.restore();
		}
	}
	if (intro && frame.introVisible) bookend(intro, true);
	if (outro && frame.outroVisible) bookend(outro, false);
	ctx.restore();
}
