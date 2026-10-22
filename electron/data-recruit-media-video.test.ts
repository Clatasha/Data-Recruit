import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./media/audioPeaks", () => ({ resolveFfmpeg: () => "/bundled/ffmpeg" }));

import { createBookendVideoProxy } from "./data-recruit-media-video";

afterEach(() => {
	vi.clearAllMocks();
	vi.useRealTimers();
});
function child() {
	return Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
}
it("prepares only the selected video trim as lossless software VP9 without audio or a shell", async () => {
	const process = child(),
		controller = new AbortController();
	mocks.spawn.mockImplementation(() => {
		queueMicrotask(() => process.emit("close", 0));
		return process;
	});
	await createBookendVideoProxy(
		"/cached/source.mp4",
		"/cached/proxy.webm",
		7,
		3,
		controller.signal,
	);
	expect(mocks.spawn.mock.calls[0][1]).toEqual(
		expect.arrayContaining([
			"-ss",
			"7",
			"-t",
			"3",
			"-an",
			"libvpx-vp9",
			"-lossless",
			"1",
			"/cached/proxy.webm",
		]),
	);
	expect(mocks.spawn.mock.calls[0][2]).toMatchObject({
		signal: controller.signal,
		windowsHide: true,
	});
	expect(mocks.spawn.mock.calls[0][2].shell).toBeUndefined();
});
it("bounds conversion time and reports decoder errors", async () => {
	vi.useFakeTimers();
	const process = child();
	process.kill.mockImplementation(() => {
		process.emit("close", null);
		return true;
	});
	mocks.spawn.mockReturnValue(process);
	const pending = createBookendVideoProxy(
		"/cached/source.mp4",
		"/cached/proxy.webm",
		0,
		3,
		new AbortController().signal,
	);
	const failure = expect(pending).rejects.toThrow("timed out");
	await vi.advanceTimersByTimeAsync(600_000);
	await failure;
	expect(process.kill).toHaveBeenCalledOnce();
});
it("does not start a conversion after cancellation", async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		createBookendVideoProxy("/cached/source.mp4", "/cached/proxy.webm", 0, 3, controller.signal),
	).rejects.toThrow();
	expect(mocks.spawn).not.toHaveBeenCalled();
});
