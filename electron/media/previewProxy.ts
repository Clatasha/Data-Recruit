import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveFfmpeg } from "./audioPeaks";

export interface ProxyStatus {
	state: "queued" | "generating" | "ready" | "error" | "cancelled";
	progress: number;
	path?: string;
	message?: string;
}
export function proxyKey(filePath: string, size: number, mtimeMs: number) {
	return createHash("sha256")
		.update(JSON.stringify(["720p-mpeg4-v2", filePath, size, mtimeMs]))
		.digest("hex");
}
export function proxyArgs(source: string, target: string) {
	return [
		"-y",
		"-i",
		source,
		"-map",
		"0:v:0",
		"-map",
		"0:a?",
		"-vf",
		"scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
		"-c:v",
		// The packaged LGPL FFmpeg has no libx264. MPEG-4 Part 2 is a
		// built-in encoder, and its small 720p frames decode cheaply in
		// the native compositor without requiring a hardware encoder.
		"mpeg4",
		"-threads",
		"2",
		"-q:v",
		"3",
		"-pix_fmt",
		"yuv420p",
		"-fps_mode:v",
		"passthrough",
		"-enc_time_base:v",
		"1:60000",
		"-g",
		"30",
		"-bf",
		"0",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-movflags",
		"+faststart",
		"-progress",
		"pipe:1",
		"-nostats",
		target,
	];
}

/** One encode at a time: proxy preparation must not swamp editor playback. */
export class PreviewProxyService {
	private jobs = new Map<string, ProxyStatus>();
	private queue: Array<() => Promise<void>> = [];
	private active: ChildProcess | null = null;
	private running = false;
	private generation = 0;
	constructor(private directory: string) {}
	async request(source: string, durationSec: number): Promise<ProxyStatus> {
		const stat = await fs.stat(source);
		const key = proxyKey(source, stat.size, stat.mtimeMs);
		const existing = this.jobs.get(key);
		if (existing && existing.state !== "cancelled") {
			if (
				existing.state !== "ready" ||
				(existing.path &&
					(await fs.stat(existing.path).then(
						() => true,
						() => false,
					)))
			)
				return { ...existing };
			this.jobs.delete(key);
		}
		const target = path.join(this.directory, `${key}.mp4`);
		try {
			if ((await fs.stat(target)).size > 0) return { state: "ready", progress: 100, path: target };
		} catch {
			/* Not generated yet. */
		}
		const status: ProxyStatus = { state: "queued", progress: 0 };
		this.jobs.set(key, status);
		const generation = this.generation;
		this.queue.push(async () => {
			if (generation !== this.generation) return;
			const temporary = target.replace(/\.mp4$/, ".partial.mp4");
			try {
				await fs.mkdir(this.directory, { recursive: true });
				if (generation !== this.generation) return;
				const ffmpeg = resolveFfmpeg();
				if (!ffmpeg) throw new Error("Video preparation tool is unavailable");
				status.state = "generating";
				await new Promise<void>((resolve, reject) => {
					const child = spawn(ffmpeg, proxyArgs(source, temporary), {
						windowsHide: true,
						stdio: ["ignore", "pipe", "pipe"],
					});
					this.active = child;
					let pending = "";
					let error = "";
					child.stdout?.on("data", (data: Buffer) => {
						pending += data.toString();
						const lines = pending.split(/\r?\n/);
						pending = lines.pop() ?? "";
						for (const line of lines) {
							const match = /^out_time_us=(\d+)/.exec(line);
							if (match && durationSec > 0)
								status.progress = Math.min(99, (Number(match[1]) / 1e6 / durationSec) * 100);
						}
					});
					child.stderr?.on("data", (data: Buffer) => {
						error = (error + data.toString()).slice(-2000);
					});
					child.once("error", reject);
					child.once("close", (code) =>
						code === 0 ? resolve() : reject(new Error(error || "Proxy generation stopped")),
					);
				});
				if (generation !== this.generation) return;
				// Native cursor lookup follows the preview source path at clip boundaries.
				await fs.copyFile(`${source}.cursor.json`, `${target}.cursor.json`).catch(() => {
					/* Recordings with a system cursor have no sidecar. */
				});
				if (generation !== this.generation) return;
				await fs.rename(temporary, target);
				Object.assign(status, { state: "ready", progress: 100, path: target });
			} catch (error) {
				if (generation === this.generation)
					Object.assign(status, { state: "error", message: String(error) });
			} finally {
				this.active = null;
				await fs.rm(temporary, { force: true }).catch(() => {
					/* Best-effort cleanup after cancellation or encoder failure. */
				});
			}
		});
		void this.drain();
		return { ...status };
	}
	cancel() {
		this.generation++;
		this.queue = [];
		for (const status of this.jobs.values())
			if (status.state === "queued" || status.state === "generating" || status.state === "error")
				status.state = "cancelled";
		this.active?.kill();
	}
	private async drain() {
		if (this.running) return;
		this.running = true;
		try {
			while (this.queue.length) await this.queue.shift()?.();
		} finally {
			this.running = false;
		}
	}
}
