import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handle: vi.fn(),
	encodeAudio: vi.fn(),
	parent: vi.fn(() => null),
	message: vi.fn(),
	dialog: vi.fn(),
	write: vi.fn(),
	mkdir: vi.fn(),
}));
vi.mock("./data-recruit-audio", () => ({ encodeDataRecruitAudio: mocks.encodeAudio }));
vi.mock("electron", () => ({
	app: { getPath: () => "/videos" },
	BrowserWindow: { fromWebContents: mocks.parent },
	dialog: { showSaveDialog: mocks.dialog, showMessageBox: mocks.message },
	ipcMain: { handle: mocks.handle },
}));
vi.mock("node:fs/promises", () => ({ default: { writeFile: mocks.write, mkdir: mocks.mkdir } }));

import { registerDataRecruitIpc } from "./data-recruit";

beforeEach(() => {
	vi.clearAllMocks();
	registerDataRecruitIpc();
});
const exportHandler = () =>
	mocks.handle.mock.calls.find(([name]) => name === "data-recruit:export-video")![1];
describe("explicit desktop export", () => {
	it("writes the MP4 only to the path selected in Save As", async () => {
		mocks.dialog.mockResolvedValue({ canceled: false, filePath: "/videos/chosen.mp4" });
		expect(await exportHandler()({ sender: {} }, new ArrayBuffer(8))).toBe("/videos/chosen.mp4");
		expect(mocks.write).toHaveBeenCalledWith("/videos/chosen.mp4", expect.any(Buffer));
	});
	it("cancels without writing a file", async () => {
		mocks.dialog.mockResolvedValue({ canceled: true });
		expect(await exportHandler()({ sender: {} }, new ArrayBuffer(8))).toBeNull();
		expect(mocks.write).not.toHaveBeenCalled();
	});
	it("rejects malformed video bytes before opening a dialog", async () => {
		await expect(exportHandler()({ sender: {} }, "invalid")).rejects.toThrow("Invalid video data");
		expect(mocks.dialog).not.toHaveBeenCalled();
	});
});

describe("unsaved builder protection", () => {
	it("asks before closing a dirty project and keeps working when cancelled", async () => {
		let onClose: ((event: { preventDefault: () => void }) => void) | undefined;
		const parent = {
			on: vi.fn((_name: string, callback: typeof onClose) => {
				onClose = callback;
			}),
			close: vi.fn(),
		};
		mocks.parent.mockReturnValue(parent as never);
		const dirtyHandler = mocks.handle.mock.calls.find(
			([name]) => name === "data-recruit:set-dirty",
		)![1];
		dirtyHandler({ sender: {} }, true);
		const event = { preventDefault: vi.fn() };
		mocks.message.mockResolvedValue({ response: 0 });
		onClose!(event);
		await vi.waitFor(() => expect(mocks.message).toHaveBeenCalledOnce());
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(parent.close).not.toHaveBeenCalled();
		await Promise.resolve();
		mocks.message.mockResolvedValue({ response: 1 });
		onClose!(event);
		await vi.waitFor(() => expect(parent.close).toHaveBeenCalledOnce());
		mocks.parent.mockReturnValue(null);
	});
});

it("finishes audio through an app-owned job and restricts cancellation to its window", async () => {
	const sender = { id: 42, once: vi.fn(), removeListener: vi.fn() };
	let signal: AbortSignal | undefined;
	mocks.encodeAudio.mockImplementation((_bytes, jobSignal) => {
		signal = jobSignal;
		return new Promise((_resolve, reject) =>
			jobSignal.addEventListener("abort", () => reject(new Error("cancelled"))),
		);
	});
	const encode = mocks.handle.mock.calls.find(([name]) => name === "data-recruit:encode-audio")![1];
	const cancel = mocks.handle.mock.calls.find(([name]) => name === "data-recruit:cancel-audio")![1];
	const result = encode({ sender }, new ArrayBuffer(8), "test-export-123");
	cancel({ sender: { id: 99 } }, "test-export-123");
	expect(signal?.aborted).toBe(false);
	cancel({ sender }, "test-export-123");
	await expect(result).rejects.toThrow("cancelled");
	expect(sender.removeListener).toHaveBeenCalledWith("destroyed", expect.any(Function));
	await expect(encode({ sender }, "invalid", "test-export-123")).rejects.toThrow("Invalid video");
});
