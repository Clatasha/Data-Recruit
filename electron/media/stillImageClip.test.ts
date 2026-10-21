import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ensureStillImageClip } from "./stillImageClip";

vi.mock("./audioPeaks", () => ({ resolveFfmpeg: () => "/usr/bin/ffmpeg" }));
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});
const encoderAvailable = existsSync("/usr/bin/ffmpeg") && existsSync("/usr/bin/ffprobe");
it.skipIf(!encoderAvailable)(
	"imports a lossless five-second still and reuses the cached clip",
	async () => {
		const dir = await fs.mkdtemp(path.join(tmpdir(), "reaction-image-"));
		directories.push(dir);
		const image = path.join(dir, "picture with spaces.png");
		execFileSync("/usr/bin/ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=32x24",
			"-frames:v",
			"1",
			"-threads",
			"1",
			image,
		]);
		const output = await ensureStillImageClip(image, path.join(dir, "cache"));
		const probe = JSON.parse(
			execFileSync(
				"/usr/bin/ffprobe",
				["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
				{ encoding: "utf8" },
			),
		);
		expect(probe.streams).toHaveLength(1);
		expect(probe.streams[0]).toMatchObject({ codec_name: "vp9", width: 32, height: 24 });
		expect(Number(probe.format.duration)).toBeCloseTo(5, 2);
		expect(await ensureStillImageClip(image, path.join(dir, "cache"))).toBe(output);
		expect(await fs.readdir(path.join(dir, "cache"))).toHaveLength(1);
		const gif = path.join(dir, "sticker.gif");
		execFileSync("/usr/bin/ffmpeg", [
			"-v",
			"error",
			"-i",
			image,
			"-frames:v",
			"1",
			"-threads",
			"1",
			gif,
		]);
		const gifClip = await ensureStillImageClip(gif, path.join(dir, "cache"));
		const gifDuration = execFileSync(
			"/usr/bin/ffprobe",
			["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", gifClip],
			{ encoding: "utf8" },
		);
		expect(Number(gifDuration)).toBeCloseTo(5, 2);
	},
	20000,
);

it.skipIf(!encoderAvailable)(
	"removes partial files after an invalid image fails to decode",
	async () => {
		const dir = await fs.mkdtemp(path.join(tmpdir(), "reaction-image-"));
		directories.push(dir);
		const image = path.join(dir, "broken.png");
		await fs.writeFile(image, "invalid image");
		await expect(ensureStillImageClip(image, path.join(dir, "cache"))).rejects.toThrow(
			"Image import failed",
		);
		expect(await fs.readdir(path.join(dir, "cache"))).toEqual([]);
	},
);
