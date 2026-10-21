// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { DEFAULT_CREATIVE_SETTINGS } from "@/lib/ai-edition/creative/settings";
import { CreativeClipPreview } from "./CreativeClipPreview";

const mocks = vi.hoisted(() => ({
	setCompositorScene: vi.fn(async (_id: number, _scene: string) => ({ ok: true })),
	setCompositorTime: vi.fn(async () => ({ ok: true })),
	setCompositorPlaying: vi.fn(async () => ({ ok: true })),
	useNativeCompositorView: vi.fn((_ref: unknown, _options: unknown) => ({
		viewId: 7,
		error: null,
	})),
}));
vi.mock("@/native/hooks/useNativeCompositorView", () => ({
	useNativeCompositorView: mocks.useNativeCompositorView,
}));
vi.mock("@/native/compositorViewClient", () => ({
	setCompositorScene: mocks.setCompositorScene,
	setCompositorTime: mocks.setCompositorTime,
	setCompositorPlaying: mocks.setCompositorPlaying,
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("composes unsaved effect changes on an isolated native view without seeking a playing clip", async () => {
	const videoRef = { current: document.createElement("video") };
	videoRef.current.currentTime = 3;
	const base = {
		path: "/source.mp4",
		aspect: 16 / 9,
		startSec: 2,
		endSec: 8,
		playing: false,
		timeSec: 3,
		seekTimeSec: 3,
		videoRef,
		crop: { x: 0, y: 0, width: 1, height: 1 },
		settings: DEFAULT_CREATIVE_SETTINGS,
	};
	const { rerender } = render(
		<I18nProvider>
			<CreativeClipPreview {...base} />
		</I18nProvider>,
	);
	await waitFor(() => expect(mocks.setCompositorScene).toHaveBeenCalled());
	expect(mocks.useNativeCompositorView.mock.calls[0]?.[1]).toMatchObject({
		isolated: true,
		sources: { screenPath: "/source.mp4" },
	});
	rerender(
		<I18nProvider>
			<CreativeClipPreview
				{...base}
				playing
				settings={{ ...base.settings, flipHorizontal: true, overlay: "dots", opacity: 0.6 }}
			/>
		</I18nProvider>,
	);
	await act(async () => {
		/* Flush the native-view effects. */
	});
	const before = mocks.setCompositorTime.mock.calls.length;
	rerender(
		<I18nProvider>
			<CreativeClipPreview
				{...base}
				playing
				settings={{ ...base.settings, flipHorizontal: true, overlay: "dots", opacity: 0.8 }}
			/>
		</I18nProvider>,
	);
	await act(async () => {
		/* Flush the native-view effects. */
	});
	expect(mocks.setCompositorTime.mock.calls.length).toBe(before);
	const scene = JSON.parse(mocks.setCompositorScene.mock.calls.at(-1)?.[1] ?? "{}");
	expect(scene.clips[0]).toMatchObject({
		screenPath: "/source.mp4",
		creative: { flipHorizontal: true, overlay: "dots", opacity: 0.8 },
	});
});
