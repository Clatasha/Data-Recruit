import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

/** Generated files are app-owned; the renderer cannot choose an arbitrary write path. */
export function registerDataRecruitIpc() {
	const guarded = new WeakSet<BrowserWindow>();
	const dirtyWindows = new WeakMap<BrowserWindow, boolean>();
	ipcMain.handle("data-recruit:set-dirty", (event, dirty: boolean) => {
		const parent = BrowserWindow.fromWebContents(event.sender);
		if (!parent) return;
		dirtyWindows.set(parent, dirty === true);
		if (guarded.has(parent)) return;
		guarded.add(parent);
		let confirming = false;
		parent.on("close", (event) => {
			if (!dirtyWindows.get(parent)) return;
			event.preventDefault();
			if (confirming) return;
			confirming = true;
			void dialog
				.showMessageBox(parent, {
					type: "question",
					title: "Unsaved Data Recruit project",
					message: "Close without saving a project file?",
					detail:
						"Use Save project to keep a portable copy. Changes since the last recovery save may be lost.",
					buttons: ["Keep working", "Close without saving"],
					defaultId: 0,
					cancelId: 0,
				})
				.then((result) => {
					if (result.response === 1) {
						dirtyWindows.set(parent, false);
						parent.close();
					}
				})
				.finally(() => {
					confirming = false;
				});
		});
	});
	ipcMain.handle("data-recruit:export-video", async (event, bytes: ArrayBuffer) => {
		if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 1024 * 1024 * 1024)
			throw new Error("Invalid video data.");
		const parent = BrowserWindow.fromWebContents(event.sender);
		const options = {
			title: "Export Data Recruit video",
			defaultPath: path.join(app.getPath("videos"), "Data-Recruit.mp4"),
			filters: [{ name: "MP4 video", extensions: ["mp4"] }],
		};
		const chosen = parent
			? await dialog.showSaveDialog(parent, options)
			: await dialog.showSaveDialog(options);
		if (chosen.canceled || !chosen.filePath) return null;
		await fs.writeFile(chosen.filePath, Buffer.from(bytes));
		return chosen.filePath;
	});
	ipcMain.handle("data-recruit:save-video", async (_event, bytes: ArrayBuffer, recipe: string) => {
		if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 1024 * 1024 * 1024)
			throw new Error("Invalid video data.");
		if (typeof recipe !== "string" || recipe.length > 500_000_000)
			throw new Error("Invalid project data.");
		const folder = path.join(app.getPath("userData"), "data-recruit", crypto.randomUUID());
		await fs.mkdir(folder, { recursive: true });
		const output = path.join(folder, "Data Recruit.mp4");
		await fs.writeFile(output, Buffer.from(bytes));
		await fs.writeFile(path.join(folder, "recipe.json"), recipe);
		return output;
	});
}
