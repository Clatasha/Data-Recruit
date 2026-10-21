import { describe, expect, it } from "vitest";
import {
	creativeClipPath,
	creativeSourceSchema,
	DEFAULT_CREATIVE_SETTINGS,
	hasCreativeEffects,
} from "./settings";

describe("non-destructive creative sources", () => {
	it("uses a prepared source for split/trimmed windows but never outside its content", () => {
		const creativeSource = {
			path: "copy.mp4",
			sourcePath: "original.mp4",
			startSec: 2,
			endSec: 8,
			settings: { ...DEFAULT_CREATIVE_SETTINGS, reverse: true },
		};
		expect(
			creativeClipPath({ sourceStartSec: 3, sourceEndSec: 5, creativeSource }, "original.mp4"),
		).toBe("copy.mp4");
		expect(
			creativeClipPath({ sourceStartSec: 1, sourceEndSec: 5, creativeSource }, "original.mp4"),
		).toBe("original.mp4");
		expect(
			creativeClipPath({ sourceStartSec: 3, sourceEndSec: 9, creativeSource }, "original.mp4"),
		).toBe("original.mp4");
		expect(creativeSourceSchema.parse(creativeSource)).toEqual(creativeSource);
		expect(
			creativeClipPath({ sourceStartSec: 3, sourceEndSec: 5, creativeSource }, "replacement.mp4"),
		).toBe("replacement.mp4");
	});
	it("treats neutral controls as restoring the original", () => {
		expect(hasCreativeEffects(DEFAULT_CREATIVE_SETTINGS)).toBe(false);
		expect(hasCreativeEffects({ ...DEFAULT_CREATIVE_SETTINGS, reverse: true })).toBe(true);
	});
});
