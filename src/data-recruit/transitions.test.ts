import { describe, expect, it } from "vitest";
import {
	sequenceFrame,
	TRANSITIONS,
	transitionDuration,
	transitionGain,
	transitionTransform,
} from "./transitions";

describe("bookend transition timing", () => {
	it("keeps old projects as hard cuts and caps effects to available media", () => {
		expect(transitionDuration({ duration: 1 })).toBe(0);
		expect(transitionDuration({ duration: 0.3, transition: "fade", transitionSeconds: 1 })).toBe(
			0.3,
		);
		expect(sequenceFrame(2.1, 10, { duration: 2 }, null).scrollTime).toBeCloseTo(0.1);
	});
	it("continues the moving cards across the intro boundary without a position jump", () => {
		const intro = { duration: 3, transition: "scroll" as const, transitionSeconds: 0.75 };
		const before = sequenceFrame(2.999, 10, intro, null),
			after = sequenceFrame(3.001, 10, intro, null);
		expect(before.slot).toBe("intro");
		expect(after.slot).toBeNull();
		expect(after.scrollTime - before.scrollTime).toBeCloseTo(0.002);
		expect(before.progress).toBeGreaterThan(0.99);
		expect(sequenceFrame(13, 10, intro, { duration: 2, transition: "rise" }).slot).toBe("outro");
	});
	it("fades only the selected bookend portion of its audio", () => {
		const clip = { duration: 3, transition: "fade" as const, transitionSeconds: 1 };
		expect(transitionGain(clip, 2.5, "intro")).toBe(0.5);
		expect(transitionGain(clip, 0.5, "outro")).toBe(0.5);
		expect(transitionGain({ duration: 3 }, 2.5, "intro")).toBe(1);
	});
	it("ends every effect at a complete image with finite transforms in both directions", () => {
		for (const style of TRANSITIONS)
			for (const direction of ["left", "right"] as const) {
				const end = transitionTransform(style, 1, false, 1920, 1080, direction);
				expect(end).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, alpha: 1 });
				for (const value of Object.values(
					transitionTransform(style, 0.5, true, 1080, 1920, direction),
				))
					expect(Number.isFinite(value)).toBe(true);
			}
	});
});
