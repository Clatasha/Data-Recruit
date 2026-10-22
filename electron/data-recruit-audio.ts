import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { resolveFfmpeg } from "./media/audioPeaks";

/** Compress the PCM intermediate to AAC while copying the already rendered video. */
export async function encodeDataRecruitAudio(
	bytes: ArrayBuffer,
	signal: AbortSignal,
): Promise<ArrayBuffer> {
	const executable = resolveFfmpeg();
	if (!executable)
		throw new Error("The bundled desktop audio encoder is missing. Reinstall Data Recruit.");
	signal.throwIfAborted();
	const directory = await fs.mkdtemp(path.join(app.getPath("temp"), "data-recruit-audio-"));
	try {
		const source = path.join(directory, "source.mp4"),
			target = path.join(directory, "finished.mp4");
		await fs.writeFile(source, Buffer.from(bytes));
		signal.throwIfAborted();
		await new Promise<void>((resolve, reject) => {
			const child = spawn(
				executable,
				[
					"-hide_banner",
					"-loglevel",
					"error",
					"-nostdin",
					"-y",
					"-i",
					source,
					"-map",
					"0:v:0",
					"-map",
					"0:a:0",
					"-c:v",
					"copy",
					"-c:a",
					"aac",
					"-b:a",
					"192k",
					"-ar",
					"48000",
					"-movflags",
					"+faststart",
					target,
				],
				{ windowsHide: true },
			);
			let detail = "",
				timedOut = false;
			const abort = () => child.kill();
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill();
			}, 300_000);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			child.stderr.on("data", (chunk: Buffer) => {
				detail = (detail + chunk.toString()).slice(-8000);
			});
			const clean = () => {
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
			};
			child.once("error", (error) => {
				clean();
				reject(new Error(`Could not start the desktop audio encoder: ${error.message}`));
			});
			child.once("close", (code) => {
				clean();
				if (signal.aborted) reject(new Error("Export cancelled."));
				else if (timedOut)
					reject(new Error("Desktop audio encoding timed out. Try exporting again."));
				else if (code !== 0)
					reject(new Error(`Desktop audio encoding failed: ${detail.trim() || `exit ${code}`}`));
				else resolve();
			});
		});
		signal.throwIfAborted();
		return Uint8Array.from(await fs.readFile(target)).buffer;
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}
