import { afterEach, expect, it, vi } from "vitest";
import { matchDecodedColor, previewColor } from "./videoColor";

afterEach(() => vi.unstubAllGlobals());
const color = {
	matrix: "smpte170m",
	primaries: "smpte170m",
	transfer: "smpte170m",
	fullRange: false,
} as const;
it("reads and releases the native preview frame without touching a decoder configuration", () => {
	const close = vi.fn();
	vi.stubGlobal(
		"VideoFrame",
		class {
			colorSpace = { toJSON: () => color };
			close = close;
		},
	);
	expect(previewColor({ readyState: 2 } as HTMLVideoElement)).toEqual(color);
	expect(close).toHaveBeenCalledOnce();
});
it("copies only the mismatched raw frame and preserves its planes, geometry and timing", async () => {
	const created = vi.fn();
	vi.stubGlobal(
		"VideoFrame",
		class {
			constructor(bytes: Uint8Array, init: VideoFrameBufferInit) {
				created(bytes, init);
			}
		},
	);
	const copyTo = vi.fn(async (bytes: Uint8Array) => {
		bytes.set([81, 81, 81, 81, 90, 240]);
		return [
			{ offset: 0, stride: 2 },
			{ offset: 4, stride: 1 },
			{ offset: 5, stride: 1 },
		];
	});
	const frame = {
		format: "I420",
		codedWidth: 2,
		codedHeight: 2,
		displayWidth: 2,
		displayHeight: 2,
		visibleRect: { x: 0, y: 0, width: 2, height: 2 },
		timestamp: 500000,
		duration: 16667,
		colorSpace: { toJSON: () => ({ ...color, matrix: "bt709" }) },
		allocationSize: () => 6,
		copyTo,
	} as unknown as VideoFrame;
	expect(await matchDecodedColor(frame, color)).not.toBeNull();
	expect(Array.from(created.mock.calls[0][0])).toEqual([81, 81, 81, 81, 90, 240]);
	expect(created.mock.calls[0][1]).toMatchObject({
		format: "I420",
		codedWidth: 2,
		codedHeight: 2,
		timestamp: 500000,
		duration: 16667,
		colorSpace: color,
	});
});
it("avoids copies for matching profiles, opaque or RGB frames and unavailable native metadata", async () => {
	const copyTo = vi.fn();
	for (const format of ["I420", "RGBA", null]) {
		const frame = { format, colorSpace: { toJSON: () => color }, copyTo } as unknown as VideoFrame;
		expect(await matchDecodedColor(frame, color)).toBeNull();
		expect(await matchDecodedColor(frame, null)).toBeNull();
	}
	expect(copyTo).not.toHaveBeenCalled();
});

it("keeps playable imports available when optional preview metadata cannot be read", () => {
	vi.stubGlobal(
		"VideoFrame",
		class {
			constructor() {
				throw new Error("metadata unavailable");
			}
		},
	);
	expect(previewColor({ readyState: 2 } as HTMLVideoElement)).toBeNull();
	expect(previewColor({ readyState: 1 } as HTMLVideoElement)).toBeNull();
});
