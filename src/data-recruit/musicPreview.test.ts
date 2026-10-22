import { afterEach, expect, it, vi } from "vitest";
import type { MusicClip } from "./music";
import { MusicPreview } from "./musicPreview";

afterEach(() => vi.unstubAllGlobals());
it("changes listening gain without mutating clips, seeks correctly, and releases all sources", () => {
	const nodes: {
		start: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
		gain: {
			gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
			connect: ReturnType<typeof vi.fn>;
			disconnect: ReturnType<typeof vi.fn>;
		};
	}[] = [];
	class Context {
		currentTime = 0;
		state = "running";
		destination = {};
		close = vi.fn();
		createBufferSource() {
			const node = {
				start: vi.fn(),
				stop: vi.fn(),
				connect: vi.fn(),
				disconnect: vi.fn(),
				gain: {
					gain: { value: 0, setTargetAtTime: vi.fn() },
					connect: vi.fn(),
					disconnect: vi.fn(),
				},
			};
			nodes.push(node);
			return node;
		}
		createGain() {
			return nodes[nodes.length - 1].gain;
		}
	}
	vi.stubGlobal("AudioContext", Context);
	const clip = {
		id: "one",
		at: 0,
		start: 2,
		end: 6,
		duration: 8,
		loop: true,
		loopOffset: 1,
		volume: 0.8,
		muted: false,
		fadeIn: 0,
		fadeOut: 0,
		buffer: { duration: 10 },
	} as MusicClip;
	const preview = new MusicPreview();
	preview.sync([clip], 1, true, 0.25);
	expect(nodes[0].start).toHaveBeenCalledWith(0, 4, 7);
	expect(nodes[0].gain.gain.value).toBeCloseTo(0.2);
	preview.sync([clip], 1.1, true, 0);
	expect(nodes).toHaveLength(1);
	expect(nodes[0].gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.008);
	expect(clip.volume).toBe(0.8);
	preview.sync([clip], 5, true, 0.5);
	expect(nodes[0].stop).toHaveBeenCalledOnce();
	expect(nodes[1].start).toHaveBeenCalledWith(0, 4, 3);
	preview.sync([clip], 5, false, 0.5);
	expect(nodes[1].stop).toHaveBeenCalledOnce();
	preview.dispose();
});
