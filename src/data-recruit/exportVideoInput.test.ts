import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openExportVideo } from "./exportVideoInput";
import { openBookendInput } from "./mediaSource";

vi.mock("./mediaSource", () => ({ openBookendInput: vi.fn() }));
const source = "data-recruit-media:12345678-1234-1234-1234-123456789abc.mp4";
const proxy = "data-recruit-media:12345678-1234-1234-1234-123456789abc.webm";
function input(supported: boolean, first: number) {
	const track = {
		canDecode: vi.fn(async () => supported),
		getFirstTimestamp: vi.fn(async () => first),
	};
	return { getPrimaryVideoTrack: vi.fn(async () => track), dispose: vi.fn(), track };
}
beforeEach(() =>
	vi.stubGlobal("window", {
		electronAPI: {
			dataRecruitVideoProxy: vi.fn(async () => proxy),
			dataRecruitReleaseVideoProxy: vi.fn(async () => undefined),
			dataRecruitCancelBookendAudio: vi.fn(),
		},
	}),
);
afterEach(() => {
	vi.resetAllMocks();
	vi.unstubAllGlobals();
});
it("keeps supported video and audio on their original input without transcoding", async () => {
	const original = input(true, 0.25);
	vi.mocked(openBookendInput).mockResolvedValueOnce(original as never);
	const result = await openExportVideo(source, 7, 3, new AbortController().signal);
	expect(result.first).toBe(0.25);
	expect(result.videoStart).toBe(7);
	expect(window.electronAPI.dataRecruitVideoProxy).not.toHaveBeenCalled();
	await result.dispose();
	expect(original.dispose).toHaveBeenCalledOnce();
});
it("uses a trimmed software proxy for unsupported video while keeping original audio timing, and releases it", async () => {
	const original = input(false, 0.25),
		fallback = input(true, 0);
	vi.mocked(openBookendInput)
		.mockResolvedValueOnce(original as never)
		.mockResolvedValueOnce(fallback as never);
	const result = await openExportVideo(source, 7, 3, new AbortController().signal);
	expect(result.input).toBe(original);
	expect(result.track).toBe(fallback.track);
	expect(result.first).toBe(0.25);
	expect(result.videoFirst).toBe(0);
	expect(result.videoStart).toBe(0);
	expect(window.electronAPI.dataRecruitVideoProxy).toHaveBeenCalledWith(
		source.split(":")[1],
		7,
		3,
		expect.any(String),
	);
	await result.dispose();
	expect(original.dispose).toHaveBeenCalledOnce();
	expect(fallback.dispose).toHaveBeenCalledOnce();
	expect(window.electronAPI.dataRecruitReleaseVideoProxy).toHaveBeenCalledWith(proxy.split(":")[1]);
});
it("releases temporary media when cancellation arrives as proxy preparation finishes", async () => {
	const original = input(false, 0),
		controller = new AbortController();
	vi.mocked(openBookendInput).mockResolvedValueOnce(original as never);
	vi.mocked(window.electronAPI.dataRecruitVideoProxy!).mockImplementationOnce(async () => {
		controller.abort();
		return proxy;
	});
	await expect(openExportVideo(source, 0, 3, controller.signal)).rejects.toThrow();
	expect(original.dispose).toHaveBeenCalledOnce();
	expect(window.electronAPI.dataRecruitCancelBookendAudio).toHaveBeenCalledOnce();
	expect(window.electronAPI.dataRecruitReleaseVideoProxy).toHaveBeenCalledOnce();
});
