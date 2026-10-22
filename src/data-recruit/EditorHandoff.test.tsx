// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePreviewPlayback } from "@/lib/ai-edition/previewPlayback";
import { EditorHandoff } from "./EditorHandoff";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
it("holds the first frame until the native canvas has painted", () => {
	let frame: FrameRequestCallback = () => {
		/* Captured when the animation frame is scheduled. */
	};
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frame = callback;
		return 1;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	usePreviewPlayback.setState({ nativeStatus: "loading" });
	const ready = vi.fn();
	render(<EditorHandoff poster="data:image/jpeg;base64,AA==" onReady={ready} onBack={vi.fn()} />);
	expect(screen.getByRole("img").getAttribute("src")).toContain("data:image/jpeg");
	expect(ready).not.toHaveBeenCalled();
	act(() => usePreviewPlayback.setState({ nativeStatus: "ready" }));
	expect(ready).not.toHaveBeenCalled();
	act(() => frame(16));
	expect(ready).toHaveBeenCalledOnce();
});
