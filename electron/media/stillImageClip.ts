import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveFfmpeg } from "./audioPeaks";

export const STILL_IMAGE_DURATION_SEC = 5;
export function stillImageClipArgs(source: string, output: string): string[] {
	return [
		"-nostdin",
		"-xerror",
		"-y",
		"-stream_loop",
		"-1",
		"-i",
		source,
		"-t",
		String(STILL_IMAGE_DURATION_SEC),
		"-r",
		"30",
		"-an",
		"-c:v",
		"libvpx-vp9",
		"-lossless",
		"1",
		"-pix_fmt",
		"yuv420p",
		"-cpu-used",
		"4",
		"-row-mt",
		"1",
		output,
	];
}
/** A browser-compatible VP9 still clip uses the normal video preview/export path. */
export async function ensureStillImageClip(source: string, directory: string): Promise<string> {
	const stat = await fs.stat(source);
	const key = createHash("sha256").update(`${source}:${stat.size}:${stat.mtimeMs}`).digest("hex");
	const output = path.join(directory, `still-${key}.webm`);
	try {
		await fs.access(output);
		return output;
	} catch {
		/* Generate a missing cache entry. */
	}
	const ffmpeg = resolveFfmpeg();
	if (!ffmpeg) throw new Error("Bundled FFmpeg is unavailable");
	await fs.mkdir(directory, { recursive: true });
	const temporary = `${output}.${randomUUID()}.partial.webm`;
	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(ffmpeg, stillImageClipArgs(source, temporary), {
				stdio: ["ignore", "ignore", "pipe"],
			});
			const timeout = setTimeout(() => child.kill(), 60000);
			let stderr = "";
			child.stderr?.on("data", (chunk) => {
				stderr = (stderr + String(chunk)).slice(-8000);
			});
			child.once("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});
			child.once("close", (code) => {
				clearTimeout(timeout);
				if (code === 0) resolve();
				else reject(new Error(`Image import failed (${code}): ${stderr}`));
			});
		});
		await fs.rename(temporary, output);
	} catch (error) {
		await fs.rm(temporary, { force: true });
		throw error;
	}
	return output;
}
