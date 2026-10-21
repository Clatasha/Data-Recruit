// @vitest-environment jsdom
/**
 * A jump inside the clip while playing. The overlay catches it from the position each frame
 * reports; an addon that reports none leaves it to this hook, against the wall clock at 1×.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreviewPlayback } from "@/lib/ai-edition/previewPlayback";
import type { AxcutClip } from "@/lib/ai-edition/schema";
import { publishNativePosition } from "./nativeSync";

const store = vi.hoisted(() => ({
	setNativePlaying: vi.fn(),
	setNativeTime: vi.fn(),
}));

vi.mock("./nativeCompositorStore", () => ({
	getCurrentNativeViewId: () => 7,
	setNativePlaying: store.setNativePlaying,
	setNativeTime: store.setNativeTime,
	subscribeNativeCompositor: () => () => undefined,
}));

import { useNativePlaybackSync } from "./useNativePlaybackSync";

const CLIPS: AxcutClip[] = [
	{
		id: "clip_a",
		assetId: "asset_take",
		sourceStartSec: 0,
		sourceEndSec: 10,
		timelineStartSec: 0,
		timelineEndSec: 10,
		wordRefs: [],
		origin: "system",
		reason: "",
	},
];

describe("useNativePlaybackSync while playing", () => {
	let now = 1000;

	beforeEach(() => {
		vi.clearAllMocks();
		usePreviewPlayback.setState({ nativeStatus: "inactive", buffering: false });
		now = 1000;
		vi.spyOn(performance, "now").mockImplementation(() => now);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		publishNativePosition(null);
		usePreviewPlayback.setState({ nativeStatus: "inactive", buffering: false });
	});

	/** Plays from `fromSec` for a few frames, the playhead in step with the wall clock. */
	function play(fromSec: number) {
		const hook = renderHook(({ time }) => useNativePlaybackSync(true, time, CLIPS, CLIPS), {
			initialProps: { time: fromSec },
		});
		for (let frame = 1; frame <= 3; frame++) {
			now += 16;
			hook.rerender({ time: fromSec + frame * 0.016 });
		}
		return hook;
	}

	it("seeks the view on a jump inside the clip when the addon reports no position", () => {
		const hook = play(1);
		expect(store.setNativeTime).not.toHaveBeenCalled();

		now += 16;
		hook.rerender({ time: 6 });

		expect(store.setNativeTime).toHaveBeenCalledWith(6);
	});

	it("does not keep seeking a decoder that has not produced its first frame", () => {
		usePreviewPlayback.setState({ nativeStatus: "loading" });
		const hook = play(1);
		for (const time of [2, 4, 6]) {
			now += 200;
			hook.rerender({ time });
		}
		expect(store.setNativeTime).not.toHaveBeenCalled();
	});

	it("parks native playback while the requested transport waits for buffered media", () => {
		usePreviewPlayback.setState({ buffering: true });
		const hook = play(1);
		expect(store.setNativePlaying).toHaveBeenLastCalledWith(false);
		hook.unmount();
	});

	// The overlay watches the drift then; a guess at 1× here would re-seek inside speed regions.
	it("leaves the view to the overlay when the addon reports positions", () => {
		publishNativePosition({ clipIndex: 0, sourceTimeSec: 1 }, now);
		const hook = play(1);

		now += 16;
		hook.rerender({ time: 6 });

		expect(store.setNativeTime).not.toHaveBeenCalled();
	});
});
