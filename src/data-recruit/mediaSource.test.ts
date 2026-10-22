import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stream: vi.fn(), input: vi.fn() }));
vi.mock("mediabunny", () => ({
	ALL_FORMATS: [],
	BufferSource: class {},
	Input: class {
		constructor(options: unknown) {
			mocks.input(options);
		}
	},
	StreamSource: class {
		constructor(options: unknown) {
			mocks.stream(options);
		}
	},
}));

import { copyAudioChunk, openBookendInput } from "./mediaSource";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
	vi.clearAllMocks();
});
it("reads multi-GB media on demand with bounded IPC chunks rather than fetching the complete file", async () => {
	const read = vi.fn(
		async (_id: string, _offset: number, length: number) => new Uint8Array(length).fill(7).buffer,
	);
	vi.stubGlobal("window", {
		electronAPI: {
			dataRecruitBookendInfo: async () => ({ size: 3 * 1024 ** 3, url: "file:///cached.mp4" }),
			dataRecruitReadBookend: read,
		},
	});
	await openBookendInput("data-recruit-media:test.mp4");
	const options = mocks.stream.mock.calls[0][0];
	expect(options.getSize()).toBe(3 * 1024 ** 3);
	expect(read).not.toHaveBeenCalled();
	const bytes = await options.read(10, 10 + 9 * 1024 ** 2);
	expect(read.mock.calls.map((call) => call[2])).toEqual([4 * 1024 ** 2, 4 * 1024 ** 2, 1024 ** 2]);
	expect(bytes[0]).toBe(7);
	expect(bytes.at(-1)).toBe(7);
	vi.unstubAllGlobals();
});
it("copies only the trim overlap, resampling mono to stereo without decoding a whole source", () => {
	const left = new Float32Array(4),
		right = new Float32Array(4);
	const target = {
		sampleRate: 4,
		length: 4,
		numberOfChannels: 2,
		getChannelData: (c: number) => (c ? right : left),
	} as unknown as AudioBuffer;
	const source = {
		sampleRate: 2,
		duration: 1,
		numberOfChannels: 1,
		getChannelData: () => new Float32Array([0, 1]),
	} as unknown as AudioBuffer;
	copyAudioChunk(target, source, 3, 3);
	expect(Array.from(left)).toEqual([0, 0.5, 1, 1]);
	expect(right).toEqual(left);
	left.fill(0);
	right.fill(0);
	copyAudioChunk(target, source, 2.5, 3);
	expect(Array.from(left)).toEqual([1, 1, 0, 0]);
});
