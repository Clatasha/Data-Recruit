// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePreviewPreferences, usePreviewProxies } from "@/lib/ai-edition/previewPreferences";
import { createEmptyDocument } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { usePreparePreviewProxies } from "./usePreviewProxies";

afterEach(() => {
	cleanup();
	usePreviewPreferences.setState({ proxies: false });
	usePreviewProxies.setState({ jobs: {}, paths: {}, cancelled: false });
	useProjectStore.getState().clear();
	vi.unstubAllGlobals();
});
it("waits for Pause to switch proxies and never replaces original project paths", async () => {
	const document = {
		...createEmptyDocument({ projectId: "p", title: "Proxy" }),
		assets: [
			{
				id: "v",
				kind: "video" as const,
				originalPath: "/original.mp4",
				durationSec: 10,
				label: "Video",
				cameraTrack: null,
			},
		],
	};
	useProjectStore.setState({ document, playing: true });
	usePreviewPreferences.setState({ proxies: true });
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: {
			preparePreviewProxy: vi.fn(async () => ({
				state: "ready",
				progress: 100,
				path: "/cache/copy.mp4",
			})),
		},
	});
	renderHook(() => usePreparePreviewProxies());
	await waitFor(() =>
		expect(usePreviewProxies.getState().jobs["/original.mp4"]?.state).toBe("ready"),
	);
	expect(usePreviewProxies.getState().paths).toEqual({});
	act(() => useProjectStore.setState({ playing: false }));
	await waitFor(() =>
		expect(usePreviewProxies.getState().paths).toEqual({ "/original.mp4": "/cache/copy.mp4" }),
	);
	expect(useProjectStore.getState().document?.assets[0].originalPath).toBe("/original.mp4");
	act(() => usePreviewPreferences.setState({ proxies: false }));
	await waitFor(() => expect(usePreviewProxies.getState().paths).toEqual({}));
});
