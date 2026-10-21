// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePreviewMonitor } from "@/lib/ai-edition/previewMonitor";
import { usePreviewPlayback } from "@/lib/ai-edition/previewPlayback";
import { savePreviewScreenshot, TimelineUtilities } from "./TimelineUtilities";

vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
	usePreviewMonitor.setState({ volume: 1, muted: false });
	vi.restoreAllMocks();
});
it("exposes voice-over, marker and live monitoring controls", () => {
	const onVoiceover = vi.fn(),
		onMarker = vi.fn();
	render(<TimelineUtilities onVoiceover={onVoiceover} onMarker={onMarker} />);
	fireEvent.click(screen.getByLabelText("audio.addVoiceover"));
	expect(onVoiceover).toHaveBeenCalledOnce();
	fireEvent.click(screen.getByLabelText("utilities.addMarker"));
	expect(onMarker).toHaveBeenCalledOnce();
	fireEvent.change(screen.getByRole("slider"), { target: { value: "25" } });
	expect(usePreviewMonitor.getState().volume).toBe(0.25);
	fireEvent.click(screen.getByLabelText("utilities.mutePreview"));
	expect(usePreviewMonitor.getState().muted).toBe(true);
});
it("saves only the composited canvas as PNG, and handles cancel", async () => {
	usePreviewPlayback.setState({ nativeStatus: "ready", buffering: false });
	const canvas = document.createElement("canvas");
	canvas.dataset.testid = "native-compositor-mount";
	document.body.append(canvas);
	const frame = new ArrayBuffer(32);
	vi.spyOn(canvas, "toBlob").mockImplementation((callback, type) => {
		expect(type).toBe("image/png");
		callback({ arrayBuffer: async () => frame } as Blob);
	});
	const save = vi.fn(async () => ({ success: true }));
	window.electronAPI = { savePreviewScreenshot: save } as unknown as typeof window.electronAPI;
	expect(await savePreviewScreenshot()).toBe(true);
	expect(save).toHaveBeenCalledWith(frame);
	save.mockResolvedValue({ success: false, canceled: true } as { success: boolean });
	expect(await savePreviewScreenshot()).toBe(false);
	usePreviewPlayback.setState({ nativeStatus: "loading" });
	await expect(savePreviewScreenshot()).rejects.toThrow("Preview unavailable");
	expect(save).toHaveBeenCalledTimes(2);
});
