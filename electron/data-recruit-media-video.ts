import { spawn } from "node:child_process";
import { resolveFfmpeg } from "./media/audioPeaks";

/** A lossless VP9 trim supplies a portable software decoder when WebCodecs rejects the source. */
export async function createBookendVideoProxy(
	file: string,
	target: string,
	start: number,
	duration: number,
	signal: AbortSignal,
) {
	const executable = resolveFfmpeg();
	if (!executable) throw new Error("The bundled video decoder is missing. Reinstall Data Recruit.");
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
				"-ss",
				String(start),
				"-i",
				file,
				"-t",
				String(duration),
				"-map",
				"0:v:0",
				"-an",
				"-c:v",
				"libvpx-vp9",
				"-lossless",
				"1",
				"-deadline",
				"realtime",
				"-cpu-used",
				"8",
				"-threads",
				"2",
				"-pix_fmt",
				"yuv420p",
				target,
			],
			{ windowsHide: true, signal, stdio: ["ignore", "ignore", "pipe"] },
		);
		let detail = "",
			timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, 600_000);
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
			else if (timedOut || code !== 0)
				reject(
					new Error(
						`Could not prepare intro/outro video: ${timedOut ? "timed out" : detail || code}`,
					),
				);
			else resolve();
		});
	});
}
