import { describe, expect, it, vi } from "vitest";
import type { CompositorSharedFrameMeta } from "../src/native/contracts";

type Listener = (frame: VideoFrame, meta: CompositorSharedFrameMeta) => void;
const mocks = vi.hoisted(() => ({
	exposeInMainWorld: vi.fn(),
	setSharedTextureReceiver: vi.fn(),
}));
vi.mock("electron", () => ({
	contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
	ipcRenderer: {},
	sharedTexture: { setSharedTextureReceiver: mocks.setSharedTextureReceiver },
	webUtils: {},
}));
describe("shared frames for multiple preview views", () => {
	it("keeps the editor subscribed while a dialog preview mounts and closes", async () => {
		await import("./preload");
		const api = mocks.exposeInMainWorld.mock.calls[0][1] as {
			onCompositorFrame: (listener: Listener) => () => void;
		};
		const receive = mocks.setSharedTextureReceiver.mock.calls[0][0] as (
			input: { importedSharedTexture: { getVideoFrame: () => VideoFrame; release: () => void } },
			meta: CompositorSharedFrameMeta,
		) => Promise<void>;
		const editor = vi.fn(),
			dialog = vi.fn();
		const unsubscribeEditor = api.onCompositorFrame(editor);
		const unsubscribeDialog = api.onCompositorFrame(dialog);
		const close = vi.fn(),
			release = vi.fn();
		const input = {
			importedSharedTexture: { getVideoFrame: () => ({ close }) as unknown as VideoFrame, release },
		};
		const meta = {
			viewId: 7,
			gen: 1,
			width: 4,
			height: 2,
			footage: null,
			footageProjective: false,
		};
		await receive(input, meta);
		expect(editor).toHaveBeenCalledOnce();
		expect(dialog).toHaveBeenCalledOnce();
		unsubscribeDialog();
		await receive(input, meta);
		expect(editor).toHaveBeenCalledTimes(2);
		expect(dialog).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledTimes(2);
		expect(release).toHaveBeenCalledTimes(2);
		unsubscribeEditor();
	});
});
