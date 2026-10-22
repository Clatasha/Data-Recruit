// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePreviewClock } from "./usePreviewClock";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
it("paints at refresh rate while throttling controls and preserves exact pause/seek position", () => {
	let callback: FrameRequestCallback = () => {
		/* Captured when the animation frame is scheduled. */
	};
	vi.spyOn(performance, "now").mockReturnValue(0);
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((next: FrameRequestCallback) => {
			callback = next;
			return 1;
		}),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	const paint = vi.fn(),
		onPosition = vi.fn(),
		onEnded = vi.fn();
	const { result, rerender } = renderHook(
		({ playing, position }) =>
			usePreviewClock({ playing, position, duration: 2, paint, onPosition, onEnded }),
		{ initialProps: { playing: false, position: 0.25 } },
	);
	rerender({ playing: true, position: 0.25 });
	paint.mockClear();
	for (let ms = 16; ms <= 960; ms += 16) act(() => callback(ms));
	expect(paint).toHaveBeenCalledTimes(60);
	expect(onPosition.mock.calls.length).toBeLessThan(12);
	expect(result.current.current).toBeCloseTo(1.21);
	rerender({ playing: false, position: 1.21 });
	expect(paint).toHaveBeenLastCalledWith(1.21);
	rerender({ playing: false, position: 0.5 });
	expect(result.current.current).toBe(0.5);
	rerender({ playing: true, position: 0.5 });
	act(() => callback(2000));
	expect(onEnded).toHaveBeenCalledOnce();
	expect(onPosition).toHaveBeenLastCalledWith(2);
});
