import { expect, it, vi } from "vitest";
import { cardX, type ScrollSettings } from "./model";
import { drawImageFit, drawScroll } from "./render";

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

it("fits decoded canvases with the same letterbox color and geometry as preview videos", () => {
	const ctx = {
		save: vi.fn(),
		restore: vi.fn(),
		beginPath: vi.fn(),
		rect: vi.fn(),
		clip: vi.fn(),
		fillRect: vi.fn(),
		drawImage: vi.fn(),
	} as unknown as CanvasRenderingContext2D;
	const canvas = { width: 320, height: 180 } as HTMLCanvasElement;
	drawImageFit(ctx, canvas, 0, 0, 1080, 1920, "fit");
	expect(ctx.fillStyle).toBe("#111827");
	expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 656.25, 1080, 607.5);
	const video = { videoWidth: 320, videoHeight: 180 } as HTMLVideoElement;
	drawImageFit(ctx, video, 0, 0, 1080, 1920, "fit");
	expect(ctx.drawImage).toHaveBeenLastCalledWith(video, 0, 656.25, 1080, 607.5);
});
