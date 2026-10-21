import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handle: vi.fn(),
	parent: vi.fn(() => null),
	message: vi.fn(),
	dialog: vi.fn(),
	write: vi.fn(),
	mkdir: vi.fn(),
}));
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
