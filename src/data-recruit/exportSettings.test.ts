import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT, exportGeometry } from "./exportSettings";

describe("export dimensions", () => {
	it("keeps landscape and Shorts at the selected resolution", () => {
		expect(exportGeometry("landscape", DEFAULT_EXPORT)).toMatchObject({
			width: 1920,
			height: 1080,
		});
		expect(exportGeometry("shorts", { ...DEFAULT_EXPORT, resolution: 720 })).toMatchObject({
			width: 720,
			height: 1280,
		});
		expect(exportGeometry("landscape", { ...DEFAULT_EXPORT, resolution: 1440 })).toMatchObject({
			width: 2560,
			height: 1440,
		});
	});
	it("scales bitrate with resolution, frame rate and quality", () => {
		const baseline = exportGeometry("landscape", DEFAULT_EXPORT).bitrate;
		expect(exportGeometry("landscape", { ...DEFAULT_EXPORT, fps: 60 }).bitrate).toBe(baseline * 2);
		expect(
			exportGeometry("landscape", { ...DEFAULT_EXPORT, quality: "standard" }).bitrate,
		).toBeLessThan(baseline);
	});
});
