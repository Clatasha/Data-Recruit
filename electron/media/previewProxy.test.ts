import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewProxyService, proxyArgs, proxyKey } from "./previewProxy";

vi.mock("./audioPeaks", () => ({ resolveFfmpeg: () => "/usr/bin/ffmpeg" }));
const dirs: string[] = [];
const services: PreviewProxyService[] = [];
afterEach(async () => {
	services.splice(0).forEach((s) => s.cancel());
	await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});
it("invalidates proxies when the original changes and never crops or trims", () => {
	expect(proxyKey("/source.mp4", 10, 1)).not.toBe(proxyKey("/source.mp4", 10, 2));
	expect(proxyKey("/source.mp4", 10, 1)).not.toBe(proxyKey("/source.mp4", 11, 1));
	const args = proxyArgs("/source.mp4", "/proxy.mp4");
	expect(args).toContain("0:a?");
	expect(args[args.indexOf("-c:v") + 1]).toBe("mpeg4");
	expect(args).not.toContain("libx264");
	expect(args).not.toContain("-preset");
	expect(args).not.toContain("-crf");
	expect(args).not.toContain("-ss");
	expect(args.join(" ")).not.toContain("crop=");
});
it.skipIf(!existsSync("/usr/bin/ffmpeg") || !existsSync("/usr/bin/ffprobe"))(
	"generates and reuses a full-frame proxy with audio and the same duration",
	async () => {
		const dir = await fs.mkdtemp(path.join(tmpdir(), "reaction-proxy-"));
		dirs.push(dir);
		const source = path.join(dir, "original with spaces.webm");
		execFileSync("/usr/bin/ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=s=1920x1080:r=15",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440",
			"-t",
			"1",
			"-c:v",
			"libvpx-vp9",
			"-threads",
			"2",
			"-deadline",
			"realtime",
			"-c:a",
			"libopus",
			source,
		]);
		await fs.writeFile(`${source}.cursor.json`, '{"positions":[]}');
		const service = new PreviewProxyService(path.join(dir, "cache"));
		services.push(service);
		await service.request(source, 1);
		let proxy = "";
		await vi.waitFor(
			async () => {
				const status = await service.request(source, 1);
				expect(status.state, status.message).toBe("ready");
				proxy = status.path!;
			},
			{ timeout: 15000 },
		);
		const metadata = JSON.parse(
			execFileSync(
				"/usr/bin/ffprobe",
				["-v", "error", "-show_streams", "-show_format", "-of", "json", proxy],
				{ encoding: "utf8" },
			),
		);
		expect(
			metadata.streams.find((s: { codec_type: string }) => s.codec_type === "video"),
		).toMatchObject({ codec_name: "mpeg4", width: 1280, height: 720 });
		expect(metadata.streams.some((s: { codec_type: string }) => s.codec_type === "audio")).toBe(
			true,
		);
		expect(Number(metadata.format.duration)).toBeCloseTo(1, 1);
		expect(await fs.readFile(`${proxy}.cursor.json`, "utf8")).toBe('{"positions":[]}');
		const cached = new PreviewProxyService(path.join(dir, "cache"));
		services.push(cached);
		expect(await cached.request(source, 1)).toEqual({ state: "ready", progress: 100, path: proxy });
	},
	20000,
);

it.skipIf(!existsSync("/usr/bin/ffmpeg"))(
	"cancels queued work before spawning and allows a subsequent retry",
	async () => {
		const dir = await fs.mkdtemp(path.join(tmpdir(), "reaction-proxy-cancel-"));
		dirs.push(dir);
		const source = path.join(dir, "fake.mp4");
		await fs.writeFile(source, "not a movie");
		const service = new PreviewProxyService(path.join(dir, "cache"));
		services.push(service);
		await service.request(source, 1);
		service.cancel();
		// No cancelled job may publish a ready path or a half-written file.
		expect((await service.request(source, 1)).path).toBeUndefined();
		await vi.waitFor(async () => expect((await service.request(source, 1)).state).toBe("error"));
		expect((await service.request(source, 1)).state).toBe("error");
	},
);
