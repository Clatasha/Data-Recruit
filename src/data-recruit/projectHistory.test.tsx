// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProjectHistory } from "./projectHistory";

afterEach(() => vi.useRealTimers());
it("groups a multi-field operation and restores its media references with undo/redo", () => {
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	const media = { name: "image" };
	const { result } = renderHook(() => useProjectHistory({ text: "old", images: [media] }));
	act(() => {
		result.current.update("text", "new");
		result.current.update("images", []);
	});
	act(() => result.current.undo());
	expect(result.current.present.text).toBe("old");
	expect(result.current.present.images[0]).toBe(media);
	act(() => result.current.redo());
	expect(result.current.present).toEqual({ text: "new", images: [] });
	act(() => {
		vi.advanceTimersByTime(1000);
		result.current.update("text", "newer");
	});
	act(() => result.current.undo());
	expect(result.current.present.text).toBe("new");
	act(() => {
		vi.advanceTimersByTime(1000);
		result.current.update("text", "branch");
	});
	expect(result.current.canRedo).toBe(false);
});
