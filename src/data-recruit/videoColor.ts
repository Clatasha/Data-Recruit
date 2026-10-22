import type { InputVideoTrack } from "mediabunny";

/** Match the native player's actual decoded color metadata, including untagged AVC.
 * Do not guess from resolution or replace encoded YUV metadata with an RGB canvas profile.
 * Mediabunny's track returns its cached decoder configuration, used by CanvasSink.
 */
export async function matchPreviewColor(
	track: Pick<InputVideoTrack, "getDecoderConfig">,
	media: HTMLVideoElement,
) {
	if (typeof VideoFrame === "undefined" || media.readyState < 2) return;
	const frame = new VideoFrame(media, { timestamp: 0 });
	try {
		const color = frame.colorSpace.toJSON();
		console.debug("Data Recruit decoder color", JSON.stringify(color));
		if (!color.matrix || color.matrix === "rgb" || !color.primaries || !color.transfer) return;
		const config = await track.getDecoderConfig();
		if (config) config.colorSpace = color;
	} finally {
		frame.close();
	}
}
