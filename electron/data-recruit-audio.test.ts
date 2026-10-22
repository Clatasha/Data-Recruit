import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(),
	resolve: vi.fn(),
	mkdir: vi.fn(),
	write: vi.fn(),
	read: vi.fn(),
	rm: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
	default: { mkdtemp: mocks.mkdir, writeFile: mocks.write, readFile: mocks.read, rm: mocks.rm },
}));
vi.mock("electron", () => ({ app: { getPath: () => "/temp" } }));
vi.mock("./media/audioPeaks", () => ({ resolveFfmpeg: mocks.resolve }));

import { encodeDataRecruitAudio } from "./data-recruit-audio";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolve.mockReturnValue("/bundled/ffmpeg-shared.exe");
	mocks.mkdir.mockResolvedValue("/temp/job");
	mocks.read.mockResolvedValue(Buffer.from([1, 2, 3]));
});
function child() {
	return Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
}
it("copies the rendered video, encodes AAC, and removes temporary media", async () => {
	const process = child();
	mocks.spawn.mockImplementation(() => {
		queueMicrotask(() => process.emit("close", 0));
		return process;
	});
	const bytes = await encodeDataRecruitAudio(new ArrayBuffer(4), new AbortController().signal);
	expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3]);
	const args = mocks.spawn.mock.calls[0][1];
	expect(args).toEqual(expect.arrayContaining(["-c:v", "copy", "-c:a", "aac", "+faststart"]));
	expect(mocks.rm).toHaveBeenCalledWith("/temp/job", { recursive: true, force: true });
});
it("kills a cancelled export and cleans up its files", async () => {
	const process = child(),
		controller = new AbortController();
	process.kill.mockImplementation(() => {
		queueMicrotask(() => process.emit("close", null));
		return true;
	});
	mocks.spawn.mockReturnValue(process);
	const result = encodeDataRecruitAudio(new ArrayBuffer(4), controller.signal);
	await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
	controller.abort();
	await expect(result).rejects.toThrow("cancelled");
	expect(process.kill).toHaveBeenCalledOnce();
	expect(mocks.rm).toHaveBeenCalledOnce();
});
it("reports encoder failures without leaving intermediate files", async () => {
	const process = child();
	mocks.spawn.mockImplementation(() => {
		queueMicrotask(() => {
			process.stderr.emit("data", Buffer.from("AAC failed"));
			process.emit("close", 1);
		});
		return process;
	});
	await expect(
		encodeDataRecruitAudio(new ArrayBuffer(4), new AbortController().signal),
	).rejects.toThrow("AAC failed");
	expect(mocks.rm).toHaveBeenCalledOnce();
});
