// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { previewResolution, usePreviewPreferences } from "./previewPreferences";

afterEach(() => {
	usePreviewPreferences.setState({ quality: "auto", proxies: false });
	localStorage.clear();
});
it("halves each dimension and caps Auto at 720p without changing aspect", () => {
	expect(previewResolution(1920, 1080, 2, "quarter")).toEqual({ width: 960, height: 540 });
	expect(previewResolution(1920, 1080, 2, "half")).toEqual({ width: 1920, height: 1080 });
	expect(previewResolution(1920, 1080, 2, "auto")).toEqual({ width: 1280, height: 720 });
	expect(previewResolution(400, 800, 1, "auto")).toEqual({ width: 360, height: 720 });
});
it("persists preferences but never proxy paths and rejects invalid preferences", async () => {
	usePreviewPreferences.getState().setQuality("quarter");
	usePreviewPreferences.getState().setProxies(true);
	expect(JSON.parse(localStorage.getItem("reaction-station.preview")!).state).toEqual({
		quality: "quarter",
		proxies: true,
	});
	localStorage.setItem(
		"reaction-station.preview",
		JSON.stringify({ state: { quality: "invalid", proxies: "yes" } }),
	);
	await usePreviewPreferences.persist.rehydrate();
	expect(usePreviewPreferences.getState()).toMatchObject({ quality: "auto", proxies: false });
});
