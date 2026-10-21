import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
	type CreativeSettings,
	type CreativeSource,
	DEFAULT_CREATIVE_SETTINGS,
} from "../../src/lib/ai-edition/creative/settings";
import { resolveFfmpeg } from "./audioPeaks";

export interface CreativeClipRequest {
	path: string;
	startSec: number;
	endSec: number;
	settings: CreativeSettings;
}
export interface CreativeClipProgress {
	state: "idle" | "reversing" | "finishing" | "ready" | "cancelled" | "error";
	progress: number;
}
/** Only reverse needs preparation. Mirrors and overlays are live native effects. */
export class CreativeClipService {
	private child: ChildProcess | null = null;
	private busy = false;
	private cancelled = false;
	private status: CreativeClipProgress = { state: "idle", progress: 0 };
	constructor(private directory: string) {}
	getProgress(): CreativeClipProgress {
		return { ...this.status };
	}
	cancel() {
		this.cancelled = true;
		this.child?.kill();
	}
	private async run(ffmpeg: string, args: string[]): Promise<void> {
		if (this.cancelled) throw new Error("Preparation cancelled");
		await new Promise<void>((resolve, reject) => {
			const child = spawn(
				ffmpeg,
				["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args],
				{ stdio: ["ignore", "ignore", "pipe"] },
			);
			this.child = child;
			let stderr = "";
			const timer = setTimeout(() => child.kill(), 30 * 60 * 1000);
			child.stderr?.on("data", (data) => {
				stderr = (stderr + String(data)).slice(-8000);
			});
			child.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.once("close", (code) => {
				clearTimeout(timer);
				if (this.child === child) this.child = null;
				if (code === 0 && !this.cancelled) resolve();
				else
					reject(
						new Error(
							this.cancelled
								? "Preparation cancelled"
								: `Reverse preparation failed (${code}): ${stderr}`,
						),
					);
			});
		});
	}
	async prepare(request: CreativeClipRequest): Promise<CreativeSource> {
		if (this.busy) throw new Error("Another reverse clip is being prepared");
		if (!request.settings?.reverse) throw new Error("Live effects do not need preparation");
		this.busy = true;
		this.cancelled = false;
		this.status = { state: "reversing", progress: 0 };
		try {
			const result = await this.prepareOne(request);
			if (this.cancelled) throw new Error("Preparation cancelled");
			this.status = { state: "ready", progress: 100 };
			return result;
		} catch (error) {
			this.status = {
				state: this.cancelled ? "cancelled" : "error",
				progress: this.status.progress,
			};
			throw error;
		} finally {
			this.busy = false;
		}
	}
	private async prepareOne(request: CreativeClipRequest): Promise<CreativeSource> {
		const { startSec, endSec } = request;
		if (
			!Number.isFinite(startSec) ||
			!Number.isFinite(endSec) ||
			startSec < 0 ||
			endSec <= startSec
		)
			throw new Error("Invalid clip range");
		const ffmpeg = resolveFfmpeg();
		if (!ffmpeg) throw new Error("Bundled FFmpeg is unavailable");
		const stat = await fs.stat(request.path);
		// Live settings are deliberately absent from the key. A color/opacity/flip change
		// can never invalidate a prepared reverse or start another encode.
		const key = createHash("sha256")
			.update(
				JSON.stringify(["reverse-v3", request.path, stat.size, stat.mtimeMs, startSec, endSec]),
			)
			.digest("hex");
		const output = path.join(this.directory, `${key}.mp4`);
		const result = {
			path: output,
			sourcePath: request.path,
			startSec,
			endSec,
			settings: { ...DEFAULT_CREATIVE_SETTINGS, reverse: true },
		};
		try {
			await fs.access(output);
			return result;
		} catch {
			/* Prepare a missing copy. */
		}
		const work = path.join(this.directory, randomUUID());
		try {
			await fs.mkdir(work, { recursive: true });
			const duration = endSec - startSec;
			const pieces: string[] = [];
			const total = Math.ceil(duration);
			for (let end = endSec; end > startSec + 0.000001; ) {
				const begin = Math.max(startSec, end - 1);
				const file = path.join(work, `part-${pieces.length}.mp4`);
				await this.run(ffmpeg, [
					"-ss",
					String(begin),
					"-t",
					String(end - begin),
					"-i",
					request.path,
					"-an",
					"-vf",
					"reverse,setpts=PTS-STARTPTS",
					"-c:v",
					"mpeg4",
					"-q:v",
					"2",
					"-pix_fmt",
					"yuv420p",
					"-threads",
					"2",
					"-g",
					"30",
					"-bf",
					"0",
					file,
				]);
				pieces.push(file);
				end = begin;
				this.status = { state: "reversing", progress: Math.min(90, (pieces.length / total) * 90) };
			}
			const list = path.join(work, "concat.txt");
			await fs.writeFile(list, pieces.map((file) => `file '${path.basename(file)}'`).join("\n"));
			this.status = { state: "finishing", progress: 95 };
			const temporary = path.join(work, "finished.mp4");
			// Concatenate without re-encoding the video a second time. Keep source audio
			// forward and retain the authored source clock without blank-frame padding.
			await this.run(ffmpeg, [
				"-f",
				"concat",
				"-safe",
				"1",
				"-i",
				list,
				"-ss",
				String(startSec),
				"-t",
				String(duration),
				"-i",
				request.path,
				"-map",
				"0:v:0",
				"-map",
				"1:a?",
				"-c:v",
				"copy",
				"-af",
				"asetpts=PTS-STARTPTS",
				"-c:a",
				"aac",
				"-b:a",
				"320k",
				"-t",
				String(duration),
				"-output_ts_offset",
				String(startSec),
				"-movflags",
				"+faststart",
				temporary,
			]);
			await fs.rename(temporary, output);
			return result;
		} finally {
			await fs.rm(work, { recursive: true, force: true });
		}
	}
}
