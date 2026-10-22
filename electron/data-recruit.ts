import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { encodeDataRecruitAudio } from "./data-recruit-audio";
import { registerDataRecruitMediaIpc } from "./data-recruit-media";

/** Generated files are app-owned; the renderer cannot choose an arbitrary write path. */
export function registerDataRecruitIpc() {
	registerDataRecruitMediaIpc();
	const audioJobs = new Map<string, AbortController>();
	ipcMain.handle("data-recruit:encode-audio", async (event, bytes: ArrayBuffer, id: string) => {
		if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 1024 * 1024 * 1024)
			throw new Error("Invalid video data.");
		if (typeof id !== "string" || !/^[a-z0-9-]{8,80}$/i.test(id))
			throw new Error("Invalid export ID.");
		const key = `${event.sender.id}:${id}`;
		if (audioJobs.has(key)) throw new Error("This export is already running.");
		const controller = new AbortController();
		audioJobs.set(key, controller);
		const abort = () => controller.abort();
		event.sender.once("destroyed", abort);
		try {
			return await encodeDataRecruitAudio(bytes, controller.signal);
		} finally {
			audioJobs.delete(key);
			event.sender.removeListener("destroyed", abort);
		}
	});
	ipcMain.handle("data-recruit:cancel-audio", (event, id: string) => {
		if (typeof id === "string") audioJobs.get(`${event.sender.id}:${id}`)?.abort();
	});
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
						"Use Save project to keep your settings. Imported intro/outro media stays on this computer. Changes since the last recovery save may be lost.",
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
	ipcMain.handle("data-recruit:save-project", async (event, recipe: string) => {
		if (typeof recipe !== "string" || recipe.length > 500_000_000)
			throw new Error("Invalid project data.");
		const project = JSON.parse(recipe);
		if (project?.version !== 1) throw new Error("Invalid project version.");
		const parent = BrowserWindow.fromWebContents(event.sender);
		const options = {
			title: "Save Data Recruit project",
			defaultPath: path.join(app.getPath("documents"), "Data-Recruit.project.json"),
			filters: [{ name: "Data Recruit project", extensions: ["json"] }],
		};
		const chosen = parent
			? await dialog.showSaveDialog(parent, options)
			: await dialog.showSaveDialog(options);
		if (chosen.canceled || !chosen.filePath) return null;
		await fs.writeFile(chosen.filePath, recipe, "utf8");
		return chosen.filePath;
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
