import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handle: vi.fn(),
	picker: vi.fn(),
	stat: vi.fn(),
	copy: vi.fn(),
	mkdir: vi.fn(),
	rm: vi.fn(),
	open: vi.fn(),
	decode: vi.fn(),
	proxy: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { getPath: () => "/app-data" },
	BrowserWindow: { fromWebContents: () => null },
	dialog: { showOpenDialog: mocks.picker },
	ipcMain: { handle: mocks.handle },
}));
vi.mock("node:fs/promises", () => ({
	default: {
		stat: mocks.stat,
		copyFile: mocks.copy,
		mkdir: mocks.mkdir,
		rm: mocks.rm,
		open: mocks.open,
	},
}));

vi.mock("./data-recruit-media-audio", () => ({ decodeBookendAudio: mocks.decode }));

vi.mock("./data-recruit-media-video", () => ({ createBookendVideoProxy: mocks.proxy }));

import { registerDataRecruitMediaIpc } from "./data-recruit-media";

const id = "12345678-1234-1234-1234-123456789abc.mp4";
const handler = (name: string) =>
	mocks.handle.mock.calls.find(([key]) => key === `data-recruit:${name}`)![1];
beforeEach(() => {
	vi.clearAllMocks();
	registerDataRecruitMediaIpc();
});
it("copies a compilation larger than 2 GB selected in the native picker without reading its bytes into memory", async () => {
	mocks.picker.mockResolvedValue({ canceled: false, filePaths: ["/selected/compilation.mp4"] });
	mocks.stat.mockResolvedValue({ isFile: () => true, size: 3 * 1024 ** 3 });
	const result = await handler("pick-bookend")({ sender: {} });
	expect(result).toMatchObject({ name: "compilation.mp4", kind: "video" });
	expect(result.url).toMatch(/^data-recruit-media:[a-f0-9-]{36}\.mp4$/);
	expect(mocks.copy).toHaveBeenCalledWith(
		"/selected/compilation.mp4",
		expect.stringContaining(path.join("data-recruit", "media")),
	);
});
it("cancels the picker without creating a cached copy", async () => {
	mocks.picker.mockResolvedValue({ canceled: true, filePaths: [] });
	expect(await handler("pick-bookend")({ sender: {} })).toBeNull();
	expect(mocks.copy).not.toHaveBeenCalled();
});
it("restores cached metadata after restart and rejects arbitrary paths and oversized chunks", async () => {
	mocks.stat.mockResolvedValue({ isFile: () => true, size: 300_000_000 });
	expect(await handler("bookend-info")({}, id)).toMatchObject({
		size: 300_000_000,
		url: expect.stringContaining(id),
	});
	await expect(handler("bookend-info")({}, "../../private.mp4")).rejects.toThrow("Invalid");
	await expect(handler("read-bookend")({}, id, 0, 5 * 1024 ** 2)).rejects.toThrow("range");
	await expect(handler("read-bookend")({}, id, -1, 10)).rejects.toThrow("range");
	expect(mocks.open).not.toHaveBeenCalled();
});
it("returns only bytes actually read and always closes the file", async () => {
	const close = vi.fn();
	const read = vi.fn(async (bytes: Buffer) => {
		bytes.set([4, 5, 6]);
		return { bytesRead: 3 };
	});
	mocks.open.mockResolvedValue({ close, read });
	expect(new Uint8Array(await handler("read-bookend")({}, id, 30, 16))).toEqual(
		new Uint8Array([4, 5, 6]),
	);
	expect(close).toHaveBeenCalledOnce();
	read.mockRejectedValueOnce(new Error("disk error"));
	await expect(handler("read-bookend")({}, id, 30, 16)).rejects.toThrow("disk error");
	expect(close).toHaveBeenCalledTimes(2);
});

it("restricts decode cancellation to the requesting window and removes listeners", async () => {
	const sender = { id: 10, once: vi.fn(), removeListener: vi.fn() };
	let signal: AbortSignal | undefined;
	mocks.decode.mockImplementation(
		(_file: string, _start: number, _duration: number, current: AbortSignal) => {
			signal = current;
			return new Promise((_resolve, reject) =>
				current.addEventListener("abort", () => reject(new Error("cancelled"))),
			);
		},
	);
	const pending = handler("bookend-audio")({ sender }, id, 2, 3, "bookend-test-job");
	await vi.waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
	handler("cancel-bookend-audio")({ sender: { id: 99 } }, "bookend-test-job");
	expect(signal?.aborted).toBe(false);
	handler("cancel-bookend-audio")({ sender }, "bookend-test-job");
	await expect(pending).rejects.toThrow("cancelled");
	expect(sender.removeListener).toHaveBeenCalledWith("destroyed", expect.any(Function));
	await expect(
		handler("bookend-audio")({ sender }, id, 0, 700, "bookend-test-job"),
	).rejects.toThrow("Invalid");
});

it("imports multiple music tracks as retained copies and cleans a failed batch", async () => {
	mocks.picker.mockResolvedValue({
		canceled: false,
		filePaths: ["/selected/a.mp3", "/selected/b.wav"],
	});
	mocks.stat.mockResolvedValue({ isFile: () => true });
	const result = await handler("pick-music")({ sender: {} });
	expect(result).toHaveLength(2);
	expect(result[0]).toMatchObject({
		name: "a.mp3",
		url: expect.stringMatching(/^data-recruit-media:.*\.mp3$/),
	});
	expect(mocks.copy).toHaveBeenCalledTimes(2);
	mocks.copy.mockRejectedValueOnce(new Error("disk full"));
	mocks.rm.mockResolvedValue(undefined);
	await expect(handler("pick-music")({ sender: {} })).rejects.toThrow("disk full");
	expect(mocks.rm).toHaveBeenCalled();
});

it("confines temporary video proxies to their owning window and removes them after use", async () => {
	const sender = { id: 10, once: vi.fn(), removeListener: vi.fn() };
	mocks.proxy.mockResolvedValue(undefined);
	mocks.rm.mockResolvedValue(undefined);
	const url = await handler("video-proxy")({ sender }, id, 7, 3, "video-proxy-job");
	expect(mocks.proxy).toHaveBeenCalledWith(
		expect.stringContaining(id),
		expect.stringMatching(/\.webm$/),
		7,
		3,
		expect.any(AbortSignal),
	);
	const proxyId = url.split(":")[1];
	await handler("release-video-proxy")({ sender: { id: 99 } }, proxyId);
	expect(mocks.rm).not.toHaveBeenCalled();
	await handler("release-video-proxy")({ sender }, proxyId);
	expect(mocks.rm).toHaveBeenCalledOnce();
	await expect(
		handler("video-proxy")({ sender }, "../../private.mp4", 0, 3, "video-proxy-job"),
	).rejects.toThrow("Invalid");
	await expect(handler("video-proxy")({ sender }, id, 0, 700, "video-proxy-job")).rejects.toThrow(
		"Invalid",
	);
});
