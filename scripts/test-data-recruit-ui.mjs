import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "playwright";

const output = path.resolve("release/data-recruit-preview");
await fs.mkdir(output, { recursive: true });
const ffmpeg =
	process.platform === "win32"
		? path.resolve("electron/native/bin/win32-x64/ffmpeg.exe")
		: "ffmpeg";
for (const [name, color, tone] of [
	["intro", "red", 440],
	["outro", "blue", 880],
]) {
	execFileSync(ffmpeg, [
		"-v",
		"error",
		"-y",
		"-f",
		"lavfi",
		"-i",
		`color=c=${color}:s=320x180:r=30:d=1`,
		"-f",
		"lavfi",
		"-i",
		`sine=frequency=${tone}:sample_rate=48000:duration=1`,
		"-c:v",
		"libvpx",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"libopus",
		"-shortest",
		path.join(output, `${name}.webm`),
	]);
}
// A valid MP4 with a large free atom exercises >100 MB disk-backed imports.
const largeIntro = path.join(output, "intro-large.mp4");
execFileSync(ffmpeg, [
	"-v",
	"error",
	"-y",
	"-i",
	path.join(output, "intro.webm"),
	"-c:v",
	"libopenh264",
	"-b:v",
	"200k",
	"-c:a",
	"aac",
	largeIntro,
]);
const largeHandle = await fs.open(largeIntro, "r+");
try {
	const size = (await largeHandle.stat()).size;
	const atom = Buffer.alloc(8);
	atom.writeUInt32BE(110 * 1024 ** 2);
	atom.write("free", 4);
	await largeHandle.write(atom, 0, atom.length, size);
	await largeHandle.truncate(size + 110 * 1024 ** 2);
} finally {
	await largeHandle.close();
}
const application = await electron.launch({
	executablePath: path.resolve(process.argv[2]),
	env: { ...process.env, OPENSCREEN_DISABLE_CONTENT_PROTECTION: "1" },
	timeout: 60_000,
});
let page;
try {
	page = await application.firstWindow();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.text().startsWith("Data Recruit decoder color")) console.log(message.text());
	});
	await page.getByRole("heading", { name: "Salary per movie" }).waitFor({ timeout: 60_000 });
	await page.evaluate(() =>
		window.addEventListener("data-recruit:decoder-diagnostic", (event) =>
			console.log("Data Recruit decoder color", JSON.stringify(event.detail)),
		),
	);
	const files = await page.evaluate(() =>
		["#355c79", "#93734b", "#554e81"].map((color, index) => {
			const canvas = document.createElement("canvas");
			canvas.width = 800;
			canvas.height = 1000;
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = color;
			ctx.fillRect(0, 0, 800, 1000);
			ctx.fillStyle = "white";
			ctx.font = "bold 80px Arial";
			ctx.textAlign = "center";
			ctx.fillText(`IMAGE ${index + 1}`, 400, 500);
			return canvas.toDataURL("image/png").split(",")[1];
		}),
	);
	await page.locator("input[multiple]").setInputFiles(
		files.map((content, index) => ({
			name: `${index + 1}.png`,
			mimeType: "image/png",
			buffer: Buffer.from(content, "base64"),
		})),
	);
	await page.getByRole("button", { name: "Duplicate card", exact: true }).click();
	assert.equal(await page.locator(".dr-images button").count(), 4);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	assert.equal(await page.locator(".dr-images button").count(), 3);
	await page.getByLabel("Replace image for card 1").waitFor({ state: "attached" });
	await page.getByRole("slider", { name: "Crop left / right" }).waitFor();
	await page.getByRole("button", { name: /Play/ }).click();
	await page.waitForFunction(
		() => Number(document.querySelector('[aria-label="Timeline position"]').value) > 0.2,
	);
	await page.getByRole("button", { name: "Pause", exact: false }).click();
	await page.getByRole("slider", { name: "Timeline position" }).fill("9");
	const labelPixels = await page.locator(".dr-stage canvas").evaluate((canvas) =>
		[0, 1, 2].map((index) => {
			const pixels = canvas.getContext("2d").getImageData(index * 640 + 10, 720, 330, 100).data;
			let white = 0;
			for (let at = 0; at < pixels.length; at += 4)
				if (pixels[at] > 230 && pixels[at + 1] > 230 && pixels[at + 2] > 230) white++;
			return white;
		}),
	);
	assert(
		labelPixels.every((count) => count > 1000),
		`Missing budget text in a card: ${labelPixels}`,
	);
	await page.screenshot({ path: path.join(output, "landscape.png") });
	await page.getByRole("slider", { name: "Crop left / right" }).fill("0.3");
	assert(await page.getByRole("button", { name: /Play/ }).isEnabled());
	await page.getByLabel("Replace image for card 1").setInputFiles({
		name: "correct-photo.png",
		mimeType: "image/png",
		buffer: Buffer.from(files[2], "base64"),
	});
	await page.getByRole("status").filter({ hasText: "Image #1 replaced" }).waitFor();
	assert.equal(await page.locator(".dr-images button").count(), 3);
	assert.equal(
		await page.locator(".dr-images img").first().getAttribute("alt"),
		"correct-photo.png",
	);
	await page.getByRole("button", { name: "9:16 Shorts", exact: false }).click();
	await page.getByRole("button", { name: "Build Timeline" }).click();
	await page.getByRole("button", { name: "Pause", exact: false }).click();
	assert.deepEqual(
		await page.locator(".dr-stage canvas").evaluate((canvas) => [canvas.width, canvas.height]),
		[1080, 1920],
	);
	await page.screenshot({ path: path.join(output, "shorts.png") });
	await application.evaluate(({ session }, folder) => {
		session.defaultSession.on("will-download", (_event, item) =>
			item.setSavePath(`${folder}/${item.getFilename()}`),
		);
	}, output);
	await application.evaluate(({ dialog }, folder) => {
		dialog.showSaveDialog = async () => ({
			canceled: false,
			filePath: `${folder}/Data-Recruit.mp4`,
		});
	}, output);
	await page
		.getByRole("textbox", { name: "Numbered card data" })
		.fill("1\nTitle: Export test\nBudget: $1M\nBox Office: $5M\nPaycheck: $100K");
	for (const [kind, file] of [
		["intro", largeIntro],
		["outro", path.join(output, "outro.webm")],
	]) {
		await application.evaluate(({ dialog }, selected) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
		}, file);
		await page.getByRole("button", { name: `Choose ${kind} image or video`, exact: true }).click();
		await page
			.getByRole("status")
			.filter({ hasText: `${kind === "intro" ? "Intro" : "Outro"} video added` })
			.waitFor();
	}
	// The retained copy must survive deleting the original compilation.
	await fs.unlink(largeIntro);
	await page.getByRole("button", { name: "Save project", exact: true }).click();
	await page.waitForFunction(() =>
		document.querySelector(".dr-recovery-status")?.textContent.includes("Recovery copy saved"),
	);
	const savedProject = path.join(output, "Data-Recruit.project.json");
	let saved = "";
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const candidate = await fs.readFile(savedProject, "utf8");
			JSON.parse(candidate);
			saved = candidate;
			break;
		} catch {
			/* Wait until the browser's JSON download is complete. */
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert(saved, "Project download must finish");
	assert(
		saved.length < 2_000_000,
		"Saved project must reference the compilation without embedding its bytes",
	);
	assert.match(JSON.parse(saved).intro.url, /^data-recruit-media:/);
	await page.locator('input[accept=".json"]').setInputFiles(savedProject);
	await page.getByRole("status").filter({ hasText: "Project opened" }).waitFor();
	await page.getByLabel("intro transition", { exact: true }).selectOption("scroll");
	await page.getByLabel("outro transition", { exact: true }).selectOption("scroll");
	const transitionSamples = [];
	for (const time of [3, 7]) {
		await page.getByRole("slider", { name: "Timeline position" }).fill(String(time));
		await page.waitForFunction((at) => {
			const canvas = document.querySelector(".dr-stage canvas");
			const x = canvas.width * (at === 3 ? 0.25 : 0.75);
			const rgb = canvas.getContext("2d").getImageData(x, canvas.height / 2, 1, 1).data;
			return at === 3 ? rgb[0] > 180 && rgb[2] < 50 : rgb[2] > 180 && rgb[0] < 50;
		}, time);
		const pixels = await page.locator(".dr-stage canvas").evaluate((canvas) =>
			[
				[0.25, 0.5],
				[0.75, 0.5],
				[0.25, 0.1],
				[0.75, 0.1],
			].map(([fraction, vertical]) => {
				const x = canvas.width * fraction,
					y = canvas.height * vertical;
				return {
					x,
					y,
					rgb: Array.from(canvas.getContext("2d").getImageData(x, y, 1, 1).data).slice(0, 3),
				};
			}),
		);
		transitionSamples.push({ time, pixels });
		await page.screenshot({ path: path.join(output, `connected-${time}.png`) });
	}
	await page.getByRole("button", { name: "Export MP4" }).click();
	await page.waitForFunction(
		() => {
			const status = document.querySelector(".dr-status")?.textContent || "";
			return /MP4 ready|No audio encoder|encoding failed|encoder is missing|Could not|Cannot|cancelled|timed out/i.test(
				status,
			);
		},
		undefined,
		{ timeout: 120_000 },
	);
	assert.match(
		await page.getByRole("status").innerText(),
		/MP4 ready/,
		"Desktop MP4 export must finish with sound",
	);
	assert((await fs.stat(path.join(output, "Data-Recruit.mp4"))).size > 1000);
	for (const sample of transitionSamples)
		for (const pixel of sample.pixels) {
			const rgb = execFileSync(ffmpeg, [
				"-v",
				"error",
				"-ss",
				String(sample.time),
				"-i",
				path.join(output, "Data-Recruit.mp4"),
				"-frames:v",
				"1",
				"-vf",
				`crop=2:2:${pixel.x}:${pixel.y}`,
				"-pix_fmt",
				"rgb24",
				"-f",
				"rawvideo",
				"pipe:1",
			]);
			assert(rgb.length >= 3, "Export sample must contain pixels");
			assert(
				pixel.rgb.every((value, channel) => Math.abs(value - rgb[channel]) < 12),
				`Preview/export transition mismatch at ${sample.time}s: ${pixel.rgb} vs ${Array.from(rgb.subarray(0, 3))}`,
			);
		}
	const pcm = execFileSync(ffmpeg, [
		"-v",
		"error",
		"-i",
		path.join(output, "Data-Recruit.mp4"),
		"-map",
		"0:a:0",
		"-ar",
		"48000",
		"-ac",
		"1",
		"-f",
		"s16le",
		"pipe:1",
	]);
	const rms = (from, to) => {
		let sum = 0,
			count = 0;
		for (
			let at = Math.floor(from * 48000) * 2;
			at < Math.min(pcm.length, Math.floor(to * 48000) * 2);
			at += 2
		) {
			const value = pcm.readInt16LE(at) / 32768;
			sum += value * value;
			count++;
		}
		return Math.sqrt(sum / count);
	};
	assert(rms(0.2, 0.8) > 0.02, "Intro audio must be audible");
	assert(rms(2, 4) < 0.001, "Bookend audio must not leak into the scrolling section");
	assert(
		rms(5.2, 8.8) < 0.001,
		"Outro entrance must hold the first frame without starting its audio",
	);
	assert(rms(9.2, 9.8) > 0.02, "Outro audio must start after the scrolling section");
	await page.getByRole("button", { name: "Continue in Editor" }).click();
	await page
		.getByRole("button", { name: "← Return to builder", exact: true })
		.waitFor({ timeout: 120_000 });
	await page
		.getByText("Intro and outro audio", { exact: false })
		.first()
		.waitFor({ timeout: 30_000 });
	await page.locator(".dr-handoff").waitFor({ state: "hidden", timeout: 120_000 });
	await page
		.locator('[data-testid="native-compositor-mount"][data-painted="true"]')
		.waitFor({ timeout: 30_000 });
	await page.screenshot({ path: path.join(output, "editor.png") });
	await page.getByRole("button", { name: "← Return to builder", exact: true }).click();
	await page.getByRole("heading", { name: "Salary per movie" }).waitFor();
	assert.equal(await page.locator(".dr-images button").count(), 3);
	// Add a later batch after working with the original three images.
	await page.locator("input[multiple]").setInputFiles(
		Array.from({ length: 97 }, (_, index) => ({
			name: `${index + 4}.png`,
			mimeType: "image/png",
			buffer: Buffer.from(files[index % files.length], "base64"),
		})),
	);
	await page.waitForFunction(() => document.querySelectorAll(".dr-images button").length === 100);
	assert.equal(await page.locator('.dr-images img[alt="correct-photo.png"]').count(), 1);
	const imageList = page.getByRole("region", { name: "Added images" });
	assert(await imageList.evaluate((element) => element.scrollHeight > element.clientHeight));
	await imageList.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	assert(
		await imageList.evaluate((element) => {
			const last = element.lastElementChild.getBoundingClientRect();
			const list = element.getBoundingClientRect();
			return last.top >= list.top && last.bottom <= list.bottom;
		}),
	);
	const addImages = page.locator("label.dr-drop").filter({ has: page.locator("input[multiple]") });
	assert.match(await addImages.textContent(), /Add more images/);
	await addImages.scrollIntoViewIfNeeded();
	assert(await addImages.isVisible(), "Add more images must remain accessible after scrolling");
	await page.screenshot({ path: path.join(output, "100-images.png") });
	await page.getByRole("button", { name: "New project", exact: true }).click();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	assert.equal(await page.locator(".dr-images button").count(), 100);
	await page.getByRole("button", { name: "New project", exact: true }).click();
	await page.getByRole("button", { name: "Discard and start new", exact: true }).click();
	assert.equal(await page.locator(".dr-images button").count(), 0);
	assert(await page.getByRole("button", { name: "Undo", exact: true }).isDisabled());
	assert.deepEqual(errors, []);
	console.log(
		"Data Recruit: playback after edits, image replacement, video bookends with timed audio, Save As export, Shorts and editor handoff passed.",
	);
} catch (error) {
	if (page) {
		console.error(
			"Current status and preview errors:",
			await page
				.locator('[role="status"], [role="alert"]')
				.allTextContents()
				.catch(() => []),
		);
		await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {
			/* Preserve the original failure if the window has closed. */
		});
	}
	throw error;
} finally {
	await application.evaluate(({ app }) => app.exit(0));
}
