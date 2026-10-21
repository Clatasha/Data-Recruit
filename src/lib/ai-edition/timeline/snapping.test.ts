import { describe, expect, it } from "vitest";
import { snapTimelineEdge } from "./snapping";

describe("timeline magnets", () => {
	it("snaps either moving edge while preserving the duration", () => {
		expect(snapTimelineEdge(3.94, [6], 0.1, 2, 0, 8)).toEqual({ value: 4, guide: 6 });
		expect(snapTimelineEdge(4.06, [4], 0.1, 2, 0, 8)).toEqual({ value: 4, guide: 4 });
	});
	it("leaves a disabled or out-of-radius drag where it was dropped", () => {
		expect(snapTimelineEdge(3.9, [4], 0)).toEqual({ value: 3.9, guide: null });
		expect(snapTimelineEdge(3.7, [4], 0.1)).toEqual({ value: 3.7, guide: null });
	});
	it("chooses the nearest valid edge and does not show an impossible guide", () => {
		expect(snapTimelineEdge(3.95, [3.9, 4], 0.1, 0, 0, 3.92)).toEqual({ value: 3.9, guide: 3.9 });
		expect(snapTimelineEdge(9.9, [10], 0.2, 2, 0, 8)).toEqual({ value: 8, guide: null });
	});
});
