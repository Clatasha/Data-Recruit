import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { app, ipcMain } from "electron";

/** Generated files are app-owned; the renderer cannot choose an arbitrary write path. */
export function registerDataRecruitIpc() {
	ipcMain.handle("data-recruit:save-video", async (_event, bytes: ArrayBuffer, recipe: string) => {
		if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 1024 * 1024 * 1024)
			throw new Error("Invalid video data.");
		if (typeof recipe !== "string" || recipe.length > 200_000_000)
			throw new Error("Invalid project data.");
		const folder = path.join(app.getPath("userData"), "data-recruit", crypto.randomUUID());
		await fs.mkdir(folder, { recursive: true });
		const output = path.join(folder, "Data Recruit.mp4");
		await fs.writeFile(output, Buffer.from(bytes));
		await fs.writeFile(path.join(folder, "recipe.json"), recipe);
		return output;
	});
}
