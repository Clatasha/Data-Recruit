import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_CREATIVE_SETTINGS } from "../../src/lib/ai-edition/creative/settings";
import { CreativeClipService } from "./creativeClip";

vi.mock("./audioPeaks", () => ({ resolveFfmpeg: () => "/usr/bin/ffmpeg" }));
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});
const available = existsSync("/usr/bin/ffmpeg") && existsSync("/usr/bin/ffprobe");
it.skipIf(!available)(
	"reverses a nonzero source window across chunk boundaries and keeps original audio",
	async () => {
		const dir = await fs.mkdtemp(path.join(tmpdir(), "reaction-creative-"));
		directories.push(dir);
		const source = path.join(dir, "source with spaces.mp4");
		execFileSync("/usr/bin/ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=64x36:r=10:d=2",
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=64x36:r=10:d=2",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000:duration=4",
			"-filter_complex",
			"[0:v][1:v]concat=n=2:v=1:a=0[v]",
			"-map",
			"[v]",
			"-map",
			"2:a",
			"-c:v",
			"mpeg4",
			"-c:a",
			"aac",
			source,
		]);
		const service = new CreativeClipService(path.join(dir, "copies"));
		const request = {
			path: source,
			startSec: 0.5,
			endSec: 3.5,
			settings: { ...DEFAULT_CREATIVE_SETTINGS, reverse: true },
		};
		const result = await service.prepare(request);
		const pixel = (time: number) =>
			execFileSync("/usr/bin/ffmpeg", [
				"-v",
				"error",
				"-seek_timestamp",
				"1",
				"-ss",
				String(time),
				"-i",
				result.path,
				"-frames:v",
				"1",
				"-vf",
				"scale=1:1",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			]);
		const first = pixel(0.6),
			last = pixel(3.3);
		expect(first[2]).toBeGreaterThan(200);
		expect(last[0]).toBeGreaterThan(200);
		const probe = JSON.parse(
			execFileSync(
				"/usr/bin/ffprobe",
				["-v", "error", "-show_streams", "-of", "json", result.path],
				{ encoding: "utf8" },
			),
		) as {
			streams: { codec_type: string; duration: string; start_time: string; nb_frames: string }[];
		};
		expect(probe.streams.some((stream) => stream.codec_type === "audio")).toBe(true);
		expect(
			Number(probe.streams.find((stream) => stream.codec_type === "video")?.duration),
		).toBeCloseTo(3, 1);
		expect(
			Number(probe.streams.find((stream) => stream.codec_type === "video")?.start_time),
		).toBeCloseTo(0.5, 2);
		expect(Number(probe.streams.find((stream) => stream.codec_type === "video")?.nb_frames)).toBe(
			30,
		);
		expect(await service.prepare(request)).toEqual(result);
		expect(service.getProgress()).toEqual({ state: "ready", progress: 100 });
		// Live changes never invalidate the reverse cache.
		const adjusted = await service.prepare({
			...request,
			settings: { ...request.settings, opacity: 0.8, flipHorizontal: true, overlay: "dots" },
		});
		expect(adjusted.path).toBe(result.path);
	},
	30000,
);
it("rejects invalid or zero-length windows before encoding", async () => {
	const service = new CreativeClipService("unused");
	for (const [startSec, endSec] of [
		[0, 0],
		[-1, 3],
		[2, 1],
		[0, Infinity],
	]) {
		await expect(
			service.prepare({
				path: "unused",
				startSec,
				endSec,
				settings: { ...DEFAULT_CREATIVE_SETTINGS, reverse: true },
			}),
		).rejects.toThrow("Invalid clip range");
	}
});

it("does not encode live effects", async () => {
	const service = new CreativeClipService("unused");
	await expect(
		service.prepare({
			path: "unused",
			startSec: 0,
			endSec: 1,
			settings: { ...DEFAULT_CREATIVE_SETTINGS, flipHorizontal: true },
		}),
	).rejects.toThrow("Live effects do not need preparation");
});
