// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { droppedMediaKind, readDroppedImage } from "./mediaDrop";

describe("external timeline media", () => {
	it.each([
		["reaction.MP4", "video"],
		["capture.webm", "video"],
		["photo.JPEG", "image"],
		["sticker.png", "image"],
		["voice.FLAC", "audio"],
		["music.mp3", "audio"],
		["project.json", null],
		["no-extension", null],
	])("recognises %s", (name, kind) => {
		expect(droppedMediaKind(name)).toBe(kind);
	});
	it("embeds dropped images so an overlay survives moving the original file", async () => {
		const file = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
		expect(await readDroppedImage(file)).toBe("data:image/png;base64,AQID");
	});
});
