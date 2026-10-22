import { expect, it, vi } from "vitest";
import { cardX, type ScrollSettings } from "./model";
import { drawScroll } from "./render";

it("preserves fractional card positions so slow motion does not snap to whole pixels", () => {
	const ctx = { fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
	const card = {} as HTMLCanvasElement,
		settings: ScrollSettings = {
			format: "landscape",
			direction: "left",
			secondsPerCard: 4,
			fit: "fill",
		};
	drawScroll(ctx, [card, card, card], 1.01, settings);
	const x = vi.mocked(ctx.drawImage).mock.calls[0][1];
	expect(x).toBeCloseTo(cardX(0, 3, 1.01, settings));
	expect(Number.isInteger(x)).toBe(false);
});
