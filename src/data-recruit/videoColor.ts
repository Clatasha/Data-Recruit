/** Read the player's actual source profile, rather than guessing untagged AVC colors. */
export function previewColor(media: HTMLVideoElement): VideoColorSpaceInit | null {
	if (typeof VideoFrame === "undefined" || media.readyState < 2) return null;
	let frame: VideoFrame | undefined;
	try {
		frame = new VideoFrame(media, { timestamp: 0 });
		const color = frame.colorSpace.toJSON();
		return color.matrix && color.matrix !== "rgb" && color.primaries && color.transfer
			? color
			: null;
	} catch {
		// Optional metadata must never prevent an otherwise playable import.
		return null;
	} finally {
		frame?.close();
	}
}

/** Retag raw decoded YUV planes; codec configuration and capability checks stay untouched.
 * The caller owns both frames. Only a mismatched profile needs a bounded frame copy.
 */
export async function matchDecodedColor(
	frame: VideoFrame,
	color: VideoColorSpaceInit | null,
): Promise<VideoFrame | null> {
	if (!color || !frame.format || ["RGBA", "RGBX", "BGRA", "BGRX"].includes(frame.format))
		return null;
	const actual = frame.colorSpace.toJSON();
	if (
		actual.matrix === color.matrix &&
		actual.primaries === color.primaries &&
		actual.transfer === color.transfer &&
		actual.fullRange === color.fullRange
	)
		return null;
	const rect = { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight };
	const bytes = new Uint8Array(frame.allocationSize({ rect }));
	const layout = await frame.copyTo(bytes, { rect });
	return new VideoFrame(bytes, {
		format: frame.format,
		codedWidth: frame.codedWidth,
		codedHeight: frame.codedHeight,
		visibleRect: frame.visibleRect ?? undefined,
		displayWidth: frame.displayWidth,
		displayHeight: frame.displayHeight,
		timestamp: frame.timestamp,
		duration: frame.duration ?? undefined,
		layout,
		colorSpace: color,
	});
}
