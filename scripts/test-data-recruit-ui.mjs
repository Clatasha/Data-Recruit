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
	await page.getByRole("heading", { name: "Salary per movie" }).waitFor({ timeout: 60_000 });
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
	await page
		.getByLabel("Choose intro image or video")
		.setInputFiles(path.join(output, "intro.webm"));
	await page.getByRole("status").filter({ hasText: "Intro video added" }).waitFor();
	await page
		.getByLabel("Choose outro image or video")
		.setInputFiles(path.join(output, "outro.webm"));
	await page.getByRole("status").filter({ hasText: "Outro video added" }).waitFor();
	await page.getByLabel("intro transition", { exact: true }).selectOption("fade");
	await page.getByLabel("outro transition", { exact: true }).selectOption("rise");
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
	assert(rms(5.2, 5.8) > 0.02, "Outro audio must start after the scrolling section");
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
