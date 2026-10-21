// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	pausePreview,
	playPreview,
	previewPlaybackRequested,
	usePreviewPlayback,
} from "@/lib/ai-edition/previewPlayback";
import { type AxcutClip, createAudioTrack } from "@/lib/ai-edition/schema";
import { VirtualPreview } from "./VirtualPreview";

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
	frames = [];
	usePreviewPlayback.setState({ nativeStatus: "inactive", buffering: false });
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		frames.push(cb);
		return frames.length;
	});
	vi.stubGlobal("cancelAnimationFrame", () => {
		/* driven manually */
	});
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
		/* unloaded fixture */
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	usePreviewPlayback.setState({ nativeStatus: "inactive", buffering: false });
});
function tick() {
	act(() => {
		const pending = frames;
		frames = [];
		for (const cb of pending) cb(0);
	});
}
const first: AxcutClip = {
	id: "c1",
	assetId: "a",
	sourceStartSec: 0,
	sourceEndSec: 10,
	timelineStartSec: 0,
	timelineEndSec: 10,
	wordRefs: [],
	origin: "user",
	reason: "",
};
const sources = [
	{ id: "a", src: "file:///a.mp4", label: "a", sourceAudioMuted: true },
	{ id: "b", src: "file:///b.mp4", label: "b", sourceAudioMuted: true },
];

function drive(el: HTMLMediaElement, initialReady = 4) {
	let paused = true;
	let ready = initialReady;
	Object.defineProperty(el, "paused", { configurable: true, get: () => paused });
	Object.defineProperty(el, "readyState", { configurable: true, get: () => ready });
	Object.defineProperty(el, "duration", { configurable: true, get: () => 10 });
	el.play = vi.fn(() => {
		paused = false;
		el.dispatchEvent(new Event("play"));
		return Promise.resolve();
	});
	el.pause = vi.fn(() => {
		if (!paused) {
			paused = true;
			el.dispatchEvent(new Event("pause"));
		}
	});
	return {
		ready: (value: number) => {
			ready = value;
		},
	};
}

describe("recording preview preparation", () => {
	it("waits for rendered picture and active timeline audio before starting the recording clock", async () => {
		const track = createAudioTrack({ assetId: "sound", durationSec: 10 });
		const { container } = render(
			<VirtualPreview
				videoSources={sources}
				clips={[first]}
				audioTracks={[track]}
				audioSources={[{ id: "sound", src: "file:///sound.mp4", label: "sound" }]}
			/>,
		);
		const video = container.querySelector("video")!;
		const audio = container.querySelector(
			`[data-testid="preview-audio-track-${track.id}"]`,
		) as HTMLAudioElement;
		drive(video);
		const sound = drive(audio, 1);
		act(() => {
			fireEvent.loadedMetadata(video);
			usePreviewPlayback.setState({ nativeStatus: "loading" });
			playPreview(video);
		});
		expect(video.play).not.toHaveBeenCalled();
		expect(previewPlaybackRequested(video)).toBe(true);
		act(() => usePreviewPlayback.setState({ nativeStatus: "ready" }));
		tick();
		expect(video.play).not.toHaveBeenCalled();
		sound.ready(4);
		tick();
		await act(async () => {
			await Promise.resolve();
		});
		expect(video.play).toHaveBeenCalledOnce();
		expect(usePreviewPlayback.getState().buffering).toBe(false);
	});

	it("cancels a cross-source resume when Pause is pressed before the new source loads", () => {
		const second = { ...first, id: "c2", assetId: "b", timelineStartSec: 10, timelineEndSec: 20 };
		const props = { videoSources: sources, clips: [first, second] };
		const view = render(<VirtualPreview {...props} />);
		const old = view.container.querySelector("video")!;
		drive(old);
		act(() => {
			fireEvent.loadedMetadata(old);
			playPreview(old);
		});
		view.rerender(<VirtualPreview {...props} seekTarget={{ timeSec: 12, requestId: 1 }} />);
		const next = view.container.querySelector("video")!;
		expect(next).not.toBe(old);
		drive(next);
		act(() => pausePreview(next));
		act(() => fireEvent.loadedMetadata(next));
		tick();
		expect(previewPlaybackRequested(next)).toBe(false);
		expect(next.play).not.toHaveBeenCalled();
	});

	it("disables the unused video decoder on MP4 audio imported into the timeline", () => {
		const track = createAudioTrack({ assetId: "sound", durationSec: 10 });
		const { container } = render(
			<VirtualPreview
				videoSources={sources}
				clips={[first]}
				audioTracks={[track]}
				audioSources={[{ id: "sound", src: "file:///sound.mp4", label: "sound" }]}
			/>,
		);
		const audio = container.querySelector(`[data-testid="preview-audio-track-${track.id}"]`)!;
		const unused = { selected: true };
		Object.defineProperty(audio, "audioTracks", { value: { length: 1 } });
		Object.defineProperty(audio, "videoTracks", { value: [unused] });
		fireEvent.loadedMetadata(audio);
		expect(unused.selected).toBe(false);
	});
});
