// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	attachPreviewTransport,
	pausePreview,
	playPreview,
	previewPlaybackRequested,
	usePreviewPlayback,
} from "./previewPlayback";

const cleanup: Array<() => void> = [];
beforeEach(() => usePreviewPlayback.setState({ nativeStatus: "inactive", buffering: false }));
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

function mount() {
	const video = document.createElement("video");
	let paused = true;
	let ready = false;
	Object.defineProperty(video, "paused", { get: () => paused });
	const play = vi.fn(() => {
		paused = false;
		video.dispatchEvent(new Event("play"));
		return Promise.resolve();
	});
	const pause = vi.fn(() => {
		if (paused) return;
		paused = true;
		video.dispatchEvent(new Event("pause"));
	});
	video.play = play;
	video.pause = pause;
	const pauseAudio = vi.fn();
	const cancelResume = vi.fn();
	const transport = attachPreviewTransport(video, () => ready, pauseAudio, cancelResume);
	cleanup.push(() => transport.dispose());
	return {
		video,
		play,
		pause,
		pauseAudio,
		cancelResume,
		transport,
		ready: (value: boolean) => {
			ready = value;
		},
	};
}

describe("preview transport readiness and cancellation", () => {
	it("waits without losing Play intent, then starts only once resources are ready", async () => {
		const m = mount();
		playPreview(m.video);
		expect(m.play).not.toHaveBeenCalled();
		expect(previewPlaybackRequested(m.video)).toBe(true);
		expect(usePreviewPlayback.getState().buffering).toBe(true);
		m.ready(true);
		m.transport.check();
		await Promise.resolve();
		expect(m.play).toHaveBeenCalledTimes(1);
		expect(usePreviewPlayback.getState().buffering).toBe(false);
	});

	it("Pause cancels a waiting start even though the video is already paused", () => {
		const m = mount();
		playPreview(m.video);
		pausePreview(m.video);
		m.ready(true);
		m.transport.check();
		expect(previewPlaybackRequested(m.video)).toBe(false);
		expect(m.cancelResume).toHaveBeenCalledOnce();
		expect(m.play).not.toHaveBeenCalled();
		expect(m.pauseAudio).toHaveBeenCalled();
	});

	it("parks audio and picture together when decoding stalls, preserving the pending intent", async () => {
		const m = mount();
		m.ready(true);
		playPreview(m.video);
		await Promise.resolve();
		m.ready(false);
		m.transport.check();
		expect(m.video.paused).toBe(true);
		expect(m.pauseAudio).toHaveBeenCalled();
		expect(previewPlaybackRequested(m.video)).toBe(true);
		expect(usePreviewPlayback.getState().buffering).toBe(true);
		pausePreview(m.video);
		m.ready(true);
		m.transport.check();
		expect(m.play).toHaveBeenCalledTimes(1);
	});

	it("does not resume from a late play promise after Pause", async () => {
		const m = mount();
		let resolve!: () => void;
		m.play.mockImplementation(
			() =>
				new Promise<void>((done) => {
					resolve = done;
				}),
		);
		m.ready(true);
		playPreview(m.video);
		pausePreview(m.video);
		resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(previewPlaybackRequested(m.video)).toBe(false);
		expect(m.play).toHaveBeenCalledTimes(1);
	});

	it("stops pending playback when the native renderer fails", () => {
		const m = mount();
		playPreview(m.video);
		usePreviewPlayback.setState({ nativeStatus: "error" });
		m.transport.check();
		expect(previewPlaybackRequested(m.video)).toBe(false);
		expect(usePreviewPlayback.getState().buffering).toBe(false);
	});

	it("ignores a browser Play event queued before a user Pause", () => {
		const m = mount();
		playPreview(m.video);
		pausePreview(m.video);
		m.video.dispatchEvent(new Event("play"));
		expect(previewPlaybackRequested(m.video)).toBe(false);
	});
});
