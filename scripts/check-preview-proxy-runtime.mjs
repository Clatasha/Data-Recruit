// Run against the exact vendored executable before the expensive native build.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

const ffmpeg = path.resolve(process.argv[2]);
await fs.mkdir(path.resolve("release"), { recursive: true });
const directory = await fs.mkdtemp(path.resolve("release/proxy-runtime-"));
let service;
try {
	process.env.OPENSCREEN_FFMPEG_PATH = ffmpeg;
	const bundle = path.join(directory, "proxy.cjs");
	await build({
		entryPoints: ["electron/media/previewProxy.ts"],
		outfile: bundle,
		bundle: true,
		platform: "node",
		format: "cjs",
		packages: "external",
		logLevel: "silent",
	});
	const { PreviewProxyService } = createRequire(import.meta.url)(bundle);
	const source = path.join(directory, "fixture.webm");
	execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=160x90:r=15",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000",
			"-t",
			"2",
			"-c:v",
			"libvpx-vp9",
			"-deadline",
			"realtime",
			"-c:a",
			"libopus",
			source,
		],
		{ stdio: "pipe", timeout: 30000 },
	);
	service = new PreviewProxyService(path.join(directory, "cache"));
	const deadline = Date.now() + 60000;
	let status;
	do {
		status = await service.request(source, 2);
		if (status.state === "error") throw new Error(status.message);
		if (status.state === "ready") break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	} while (Date.now() < deadline);
	assert.equal(status.state, "ready", "Proxy runtime preparation timed out");
	execFileSync(ffmpeg, ["-v", "error", "-i", status.path, "-f", "null", "-"], {
		stdio: "pipe",
		timeout: 30000,
	});
	const stillBundle = path.join(directory, "still.cjs");
	await build({
		entryPoints: ["electron/media/stillImageClip.ts"],
		outfile: stillBundle,
		bundle: true,
		platform: "node",
		format: "cjs",
		packages: "external",
		logLevel: "silent",
	});
	const { ensureStillImageClip } = createRequire(import.meta.url)(stillBundle);
	const sticker = path.join(directory, "transparent sticker.png");
	await fs.writeFile(
		sticker,
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALElEQVR4nO3OsREAAAQEQf03jQ4EImZ3/vOLABhkb3MBAgQIECBAwP0A4L0C4RD+EDWrAHUAAAAASUVORK5CYII=",
			"base64",
		),
	);
	const still = await ensureStillImageClip(sticker, path.join(directory, "images"));
	execFileSync(ffmpeg, ["-v", "error", "-i", still, "-f", "null", "-"], {
		stdio: "pipe",
		timeout: 30000,
	});
	console.log(
		"Vendored FFmpeg transparent PNG sticker import passed using the production image service.",
	);
	console.log("Vendored FFmpeg proxy encode/decode passed using the production proxy service.");
	const creativeBundle = path.join(directory, "creative.cjs");
	await build({
		entryPoints: ["electron/media/creativeClip.ts"],
		outfile: creativeBundle,
		bundle: true,
		platform: "node",
		format: "cjs",
		packages: "external",
		logLevel: "silent",
	});
	const { CreativeClipService } = createRequire(import.meta.url)(creativeBundle);
	const creative = new CreativeClipService(path.join(directory, "creative"));
	const prepared = await creative.prepare({
		path: source,
		startSec: 0.5,
		endSec: 1.5,
		settings: {
			flipHorizontal: true,
			flipVertical: true,
			reverse: true,
			overlay: "matrix",
			opacity: 0.2,
			color: "#67e8a5",
			speed: 1,
			density: 0.5,
			size: 1,
		},
	});
	execFileSync(ffmpeg, ["-v", "error", "-i", prepared.path, "-f", "null", "-"], {
		stdio: "pipe",
		timeout: 30000,
	});
	console.log("Vendored FFmpeg cached reverse production path passed.");
} finally {
	service?.cancel();
	await fs.rm(directory, { recursive: true, force: true });
}
