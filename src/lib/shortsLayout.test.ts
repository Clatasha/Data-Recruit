import { expect, it } from "vitest";
import { computeCompositeLayout } from "./compositeLayout";

const base = {
	canvasSize: { width: 1080, height: 1920 },
	screenSize: { width: 1920, height: 1080 },
	webcamSize: { width: 1280, height: 720 },
	layoutPreset: "vertical-stack" as const,
};
it("fills a portrait canvas using independent source and camera slots", () => {
	const fill = computeCompositeLayout({
		...base,
		shorts: { screenFit: "fill", cameraFit: "fill" },
	});
	expect(fill?.screenRect).toEqual({ x: 0, y: 0, width: 1080, height: 1152 });
	expect(fill?.webcamRect).toMatchObject({ x: 0, y: 1152, width: 1080, height: 768 });
	expect(fill?.screenCover).toBe(true);
	const fit = computeCompositeLayout({ ...base, shorts: { screenFit: "fit", cameraFit: "fit" } });
	expect(fit?.screenRect.width).toBe(1080);
	expect(fit?.screenRect.height).toBeCloseTo(607.5);
	expect(fit?.webcamRect?.height).toBeCloseTo(607.5);
	expect(fit?.screenCover).toBe(false);
});
it("uses the entire portrait output when no webcam is present", () => {
	const result = computeCompositeLayout({
		...base,
		webcamSize: null,
		layoutPreset: "no-webcam",
		shorts: { screenFit: "fill", cameraFit: "fit" },
	});
	expect(result?.webcamRect).toBeNull();
	expect(result?.screenRect).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
});
