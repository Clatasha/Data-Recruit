import { expect, it } from "vitest";
import { previewScreenshotBytes } from "./previewScreenshot";

it("accepts a PNG frame and rejects invalid or oversized renderer payloads", () => {
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
		"base64",
	);
	const data = Uint8Array.from(png).buffer;
	expect(previewScreenshotBytes(data)).toEqual(png);
	expect(() => previewScreenshotBytes(new ArrayBuffer(24))).toThrow();
	expect(() => previewScreenshotBytes(new ArrayBuffer(64 * 1024 * 1024 + 1))).toThrow();
	expect(() => previewScreenshotBytes("file:///somewhere")).toThrow();
});
