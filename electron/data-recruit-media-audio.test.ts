import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./media/audioPeaks", () => ({ resolveFfmpeg: () => "/bundled/ffmpeg" }));

import { decodeBookendAudio } from "./data-recruit-media-audio";

beforeEach(() => vi.clearAllMocks());
function child() {
	return Object.assign(new EventEmitter(), {
		stdout: new EventEmitter(),
		stderr: new EventEmitter(),
		kill: vi.fn(),
	});
}
it("decodes only the selected audio span to stereo PCM using the bundled decoder", async () => {
	const process = child(),
		controller = new AbortController();
	mocks.spawn.mockImplementation(() => {
		queueMicrotask(() => {
			process.stdout.emit("data", Buffer.from(new Float32Array([0.2, 0.3]).buffer));
			process.emit("close", 0);
		});
		return process;
	});
	const bytes = await decodeBookendAudio("/cached/intro.mp4", 12, 3, controller.signal);
	expect(new Float32Array(bytes)[0]).toBeCloseTo(0.2);
	expect(mocks.spawn.mock.calls[0][1]).toEqual(
		expect.arrayContaining(["-ss", "12", "-t", "3", "-vn", "-ac", "2", "-ar", "48000", "f32le"]),
	);
	expect(mocks.spawn.mock.calls[0][2].signal).toBe(controller.signal);
});
it("rejects an already cancelled decode without starting a process", async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(decodeBookendAudio("/cached/intro.mp4", 0, 3, controller.signal)).rejects.toThrow();
	expect(mocks.spawn).not.toHaveBeenCalled();
});
it("kills audio output exceeding the selected trim bound", async () => {
	const process = child();
	process.kill.mockImplementation(() => {
		queueMicrotask(() => process.emit("close", null));
		return true;
	});
	mocks.spawn.mockImplementation(() => {
		queueMicrotask(() => process.stdout.emit("data", Buffer.alloc(5 * 1024 ** 2)));
		return process;
	});
	await expect(
		decodeBookendAudio("/cached/intro.mp4", 0, 0.1, new AbortController().signal),
	).rejects.toThrow("exceeded");
	expect(process.kill).toHaveBeenCalledOnce();
});
