/** Bound renderer-supplied PNG data before opening a dialog or writing a file. */
export function previewScreenshotBytes(data: unknown): Buffer {
	if (!(data instanceof ArrayBuffer) || data.byteLength < 24 || data.byteLength > 64 * 1024 * 1024)
		throw new Error("Invalid screenshot");
	const bytes = Buffer.from(data);
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	if (
		!bytes.subarray(0, 8).equals(signature) ||
		bytes.toString("ascii", 12, 16) !== "IHDR" ||
		bytes.readUInt32BE(16) === 0 ||
		bytes.readUInt32BE(20) === 0
	)
		throw new Error("Invalid screenshot");
	return bytes;
}
