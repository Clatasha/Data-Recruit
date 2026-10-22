import { describe, expect, it, vi } from "vitest";
import type { Bookend } from "./bookends";
import type { ScrollSettings } from "./model";
import { drawSequence } from "./sequence";
import { sequenceTiming } from "./transitions";

function context() {
	return {
		save: vi.fn(),
		restore: vi.fn(),
		beginPath: vi.fn(),
		rect: vi.fn(),
		clip: vi.fn(),
		fillRect: vi.fn(),
		drawImage: vi.fn(),
		translate: vi.fn(),
		scale: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		stroke: vi.fn(),
	} as unknown as CanvasRenderingContext2D;
}
const intro: Bookend = {
	kind: "image",
	name: "intro",
	url: "",
	duration: 3,
	transition: "scroll",
	media: {} as HTMLImageElement,
};
const outro: Bookend = { ...intro, name: "outro", duration: 2 };
describe("shared preview/export compositor", () => {
	for (const direction of ["left", "right"] as const)
		it(`draws bookends flush against card edges in ${direction} motion`, () => {
			const settings: ScrollSettings = {
				format: "landscape",
				direction,
				secondsPerCard: 2,
				fit: "fill",
			};
			const cards = Array.from({ length: 8 }, () => ({}) as HTMLCanvasElement);
			const ctx = context();
			const drawBookend = vi.fn();
			drawSequence(ctx, cards, settings, 6, intro, outro, drawBookend);
			// Intro occupies the first half, the first card touches its edge.
			expect(ctx.translate).toHaveBeenCalledWith(direction === "left" ? -960 : 960, 0);
			expect(ctx.drawImage).toHaveBeenCalledWith(cards[0], direction === "left" ? 960 : 320, 0);
			expect(drawBookend).toHaveBeenCalledWith(intro);
			const t = sequenceTiming(8, settings, intro, outro);
			vi.mocked(ctx.translate).mockClear();
			vi.mocked(ctx.drawImage).mockClear();
			drawSequence(
				ctx,
				cards,
				settings,
				t.outroStart + t.outroEntry / 2,
				intro,
				outro,
				drawBookend,
			);
			expect(ctx.translate).toHaveBeenCalledWith(direction === "left" ? 960 : -960, 0);
			expect(ctx.drawImage).toHaveBeenCalledWith(cards[7], direction === "left" ? 320 : 960, 0);
			drawSequence(ctx, cards, settings, t.outroHold + 1, intro, outro, drawBookend);
			expect(ctx.translate).toHaveBeenLastCalledWith(direction === "left" ? 0 : -0, 0);
		});
	it("compresses the intro from a fixed edge and draws a burst only at the end", () => {
		const settings: ScrollSettings = {
			format: "shorts",
			direction: "left",
			secondsPerCard: 2,
			fit: "fill",
		};
		const ctx = context();
		const card = {} as HTMLCanvasElement;
		drawSequence(
			ctx,
			[card, card],
			settings,
			4,
			{ ...intro, transition: "squeeze" },
			null,
			vi.fn(),
		);
		expect(ctx.scale).toHaveBeenCalledWith(0.5, 1);
		expect(ctx.stroke).not.toHaveBeenCalled();
		drawSequence(
			ctx,
			[card, card],
			settings,
			4.95,
			{ ...intro, transition: "squeeze" },
			null,
			vi.fn(),
		);
		expect(ctx.stroke).toHaveBeenCalledTimes(16);
	});
});
