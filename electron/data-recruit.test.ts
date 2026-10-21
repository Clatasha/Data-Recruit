import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handle: vi.fn(),
	dialog: vi.fn(),
	write: vi.fn(),
	mkdir: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { getPath: () => "/videos" },
	BrowserWindow: { fromWebContents: () => null },
	dialog: { showSaveDialog: mocks.dialog },
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
