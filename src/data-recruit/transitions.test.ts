import { describe, expect, it } from "vitest";
import type { ScrollSettings } from "./model";
import {
	INTRO_TRANSITIONS,
	OUTRO_TRANSITIONS,
	outroTransition,
	sequenceFrame,
	sequenceTiming,
	transitionDuration,
	transitionTransform,
} from "./transitions";

const base: ScrollSettings = {
	format: "landscape",
	direction: "left",
	secondsPerCard: 2,
	fit: "fill",
};
describe("connected bookends", () => {
	for (const format of ["landscape", "shorts"] as const)
		for (const direction of ["left", "right"] as const) {
			it(`moves card and intro edges at the same speed in ${format}/${direction}`, () => {
				const settings = { ...base, format, direction };
				const intro = { duration: 3, transition: "scroll" as const };
				const timing = sequenceTiming(8, settings, intro, null);
				expect(sequenceFrame(2.99, 8, settings, intro, null).introProgress).toBe(0);
				const during = sequenceFrame(3 + timing.introExit / 2, 8, settings, intro, null);
				expect(during.firstX).toBeCloseTo(timing.width / 2);
				const transform = transitionTransform(
					"scroll",
					during.introProgress,
					true,
					timing.width,
					1080,
					direction,
				);
				expect(Math.abs(transform.x)).toBeCloseTo(timing.width - during.firstX);
				const before = sequenceFrame(3 + timing.introExit - 0.001, 8, settings, intro, null);
				const after = sequenceFrame(3 + timing.introExit + 0.001, 8, settings, intro, null);
				expect(before.firstX - after.firstX).toBeCloseTo(timing.speed * 0.002);
				expect(before.introVisible).toBe(true);
				expect(after.introVisible).toBe(false);
			});
			it(`stops the outro at full view and then gives it its full duration in ${format}/${direction}`, () => {
				const settings = { ...base, format, direction };
				const intro = { duration: 3, transition: "scroll" as const };
				const outro = { duration: 5, transition: "scroll" as const };
				const timing = sequenceTiming(8, settings, intro, outro);
				const during = sequenceFrame(
					timing.outroStart + timing.outroEntry / 2,
					8,
					settings,
					intro,
					outro,
				);
				expect(during.firstX + 8 * timing.cardWidth).toBeCloseTo(timing.width / 2);
				expect(during.outroTime).toBe(0);
				const hold = sequenceFrame(timing.outroHold, 8, settings, intro, outro);
				expect(hold.firstX + 8 * timing.cardWidth).toBeCloseTo(0);
				expect(sequenceFrame(timing.outroHold + 2, 8, settings, intro, outro).firstX).toBe(
					hold.firstX,
				);
				expect(sequenceFrame(timing.outroHold + 2, 8, settings, intro, outro).outroTime).toBe(2);
				expect(timing.total - timing.outroHold).toBe(5);
			});
		}
	it("squeezes monotonically against the exit edge instead of expanding over incoming cards", () => {
		const intro = { duration: 3, transition: "squeeze" as const };
		const timing = sequenceTiming(6, base, intro, null);
		for (const p of [0, 0.25, 0.5, 0.9, 0.99]) {
			const frame = sequenceFrame(3 + p * timing.introExit, 6, base, intro, null);
			const transform = transitionTransform(
				"squeeze",
				frame.introProgress,
				true,
				timing.width,
				1080,
				"left",
			);
			expect(transform.scaleX * timing.width).toBeCloseTo(frame.firstX);
		}
	});
	it("adds ease-in time without shortening even a very short outro", () => {
		const outro = { duration: 0.2, transition: "ease" as const, transitionSeconds: 1.5 };
		const t = sequenceTiming(4, base, null, outro);
		expect(t.outroEntry).toBe(1.5);
		expect(t.total - t.outroHold).toBeCloseTo(0.2);
		expect(transitionDuration({ duration: 0.2, transition: "fade", transitionSeconds: 1 })).toBe(1);
	});
	it("keeps hard cuts and migrates old outro effects without offering squeeze", () => {
		expect(transitionDuration({ duration: 1 })).toBe(0);
		expect(OUTRO_TRANSITIONS).not.toContain("squeeze");
		expect(OUTRO_TRANSITIONS).toContain("ease");
		expect(INTRO_TRANSITIONS).toContain("squeeze");
		expect(outroTransition("squeeze")).toBe("none");
		expect(outroTransition("rise")).toBe("ease");
		expect(outroTransition("fall")).toBe("ease");
	});
});
