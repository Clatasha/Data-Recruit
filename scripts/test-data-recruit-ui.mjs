import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "playwright";

const output = path.resolve("release/data-recruit-preview");
await fs.mkdir(output, { recursive: true });
const application = await electron.launch({
	executablePath: path.resolve(process.argv[2]),
	env: { ...process.env, OPENSCREEN_DISABLE_CONTENT_PROTECTION: "1" },
	timeout: 60_000,
});
try {
	const page = await application.firstWindow();
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
	await page.getByRole("button", { name: "Build Timeline" }).click();
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
	await page
		.getByRole("textbox", { name: "Numbered card data" })
		.fill("1\nTitle: Export test\nBudget: $1M\nBox Office: $5M\nPaycheck: $100K");
	await page.getByRole("button", { name: "Build Timeline" }).click();
	await page.getByRole("button", { name: "Export MP4" }).click();
	await page.getByRole("status").filter({ hasText: "MP4 ready" }).waitFor({ timeout: 120_000 });
	assert((await fs.stat(path.join(output, "Data-Recruit.mp4"))).size > 1000);
	await page.getByRole("button", { name: "Continue in Editor" }).click();
	await page
		.getByRole("button", { name: "Return to builder", exact: false })
		.waitFor({ timeout: 120_000 });
	await page.screenshot({ path: path.join(output, "editor.png") });
	await page.getByRole("button", { name: "Return to builder", exact: false }).click();
	await page.getByRole("heading", { name: "Salary per movie" }).waitFor();
	assert.equal(await page.locator(".dr-images button").count(), 3);
	assert.deepEqual(errors, []);
	console.log(
		"Data Recruit: image matching, timeline, Shorts, MP4, editor handoff and return passed.",
	);
} finally {
	await application.close();
}
