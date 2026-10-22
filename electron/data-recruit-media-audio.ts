import { spawn } from "node:child_process";
import { resolveFfmpeg } from "./media/audioPeaks";
/** Decode only the selected span, including when Electron lacks AudioDecoder. */
export async function decodeBookendAudio(
	file: string,
	start: number,
	duration: number,
	signal: AbortSignal,
): Promise<ArrayBuffer> {
	const executable = resolveFfmpeg();
	if (!executable)
		throw new Error("The bundled desktop audio decoder is missing. Reinstall Data Recruit.");
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(
			executable,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-nostdin",
				"-ss",
				String(start),
				"-i",
				file,
				"-t",
				String(duration),
				"-map",
				"0:a:0",
				"-vn",
				"-ac",
				"2",
				"-ar",
				"48000",
				"-f",
				"f32le",
				"pipe:1",
			],
			{ windowsHide: true, signal, stdio: ["ignore", "pipe", "pipe"] },
		);
		const chunks: Buffer[] = [];
		let size = 0,
			detail = "",
			limited = false,
			timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, 120_000);
		child.stdout.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > Math.ceil((duration + 1) * 48_000) * 8) {
				limited = true;
				child.kill();
				return;
			}
			chunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			detail = (detail + chunk.toString()).slice(-8000);
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(signal.aborted ? new Error("Export cancelled.") : error);
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			if (signal.aborted) reject(new Error("Export cancelled."));
			else if (limited || timedOut || code !== 0)
				reject(
					new Error(
						`Could not decode bookend audio: ${limited ? "trim output exceeded expected size" : timedOut ? "timed out" : detail || code}`,
					),
				);
			else resolve(Uint8Array.from(Buffer.concat(chunks)).buffer);
		});
	});
}
