import { afterEach, expect, it, vi } from "vitest";
import { matchPreviewColor } from "./videoColor";

afterEach(() => vi.unstubAllGlobals());
it("uses native video color metadata for export instead of an untagged decoder default", async () => {
	const color = {
		matrix: "smpte170m",
		primaries: "smpte170m",
		transfer: "smpte170m",
		fullRange: false,
	} as const;
	const close = vi.fn();
	vi.stubGlobal(
		"VideoFrame",
		class {
			colorSpace = { toJSON: () => color };
			close = close;
		},
	);
	const config: VideoDecoderConfig = { codec: "avc1.42e01e" };
	await matchPreviewColor({ getDecoderConfig: async () => config }, {
		readyState: 2,
	} as HTMLVideoElement);
	expect(config.colorSpace).toEqual(color);
	expect(close).toHaveBeenCalledOnce();
});
it("does not replace YUV color signaling with an RGB conversion's profile", async () => {
	const close = vi.fn();
	vi.stubGlobal(
		"VideoFrame",
		class {
			colorSpace = {
				toJSON: () => ({
					matrix: "rgb",
					primaries: "bt709",
					transfer: "iec61966-2-1",
					fullRange: true,
				}),
			};
			close = close;
		},
	);
	const getDecoderConfig = vi.fn();
	await matchPreviewColor({ getDecoderConfig }, { readyState: 2 } as HTMLVideoElement);
	expect(getDecoderConfig).not.toHaveBeenCalled();
	expect(close).toHaveBeenCalledOnce();
});
