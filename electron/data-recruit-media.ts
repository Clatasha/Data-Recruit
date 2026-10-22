import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

const extensions = ["mp4", "webm", "mov", "m4v", "png", "jpg", "jpeg", "webp"];
const audioExtensions = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus", "webm", "mp4"];
const idPattern =
	/^[a-f0-9-]{36}\.(?:mp4|webm|mov|m4v|png|jpg|jpeg|webp|mp3|wav|m4a|aac|ogg|flac|opus)$/i;
function mediaPath(id: string) {
	if (typeof id !== "string" || !idPattern.test(id)) throw new Error("Invalid bookend media ID.");
	return path.join(app.getPath("userData"), "data-recruit", "media", id);
}
/** Only a native picker can add media; reads are confined to app-owned copies. */
export function registerDataRecruitMediaIpc() {
	ipcMain.handle("data-recruit:pick-bookend", async (event) => {
		const parent = BrowserWindow.fromWebContents(event.sender);
		const options = {
			title: "Choose intro or outro",
			properties: ["openFile"] as "openFile"[],
			filters: [{ name: "Images and videos", extensions }],
		};
		const picked = parent
			? await dialog.showOpenDialog(parent, options)
			: await dialog.showOpenDialog(options);
		if (picked.canceled || !picked.filePaths[0]) return null;
		const source = picked.filePaths[0];
		const extension = path.extname(source).slice(1).toLowerCase();
		if (!extensions.includes(extension) || !(await fs.stat(source)).isFile())
			throw new Error("Choose a supported image or video.");
		const id = `${crypto.randomUUID()}.${extension}`,
			target = mediaPath(id);
		await fs.mkdir(path.dirname(target), { recursive: true });
		try {
			await fs.copyFile(source, target);
		} catch (error) {
			await fs.rm(target, { force: true }).catch(() => {
				/* Keep the original copy error if partial cleanup also fails. */
			});
			throw error;
		}
		return {
			name: path.basename(source),
			url: `data-recruit-media:${id}`,
			kind: ["png", "jpg", "jpeg", "webp"].includes(extension) ? "image" : "video",
		};
	});
	ipcMain.handle("data-recruit:pick-music", async (event) => {
		const parent = BrowserWindow.fromWebContents(event.sender);
		const options = {
			title: "Add music or audio",
			properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
			filters: [{ name: "Audio", extensions: audioExtensions }],
		};
		const picked = parent
			? await dialog.showOpenDialog(parent, options)
			: await dialog.showOpenDialog(options);
		if (picked.canceled) return [];
		if (picked.filePaths.length > 100) throw new Error("Choose up to 100 audio files at a time.");
		const result: { name: string; url: string }[] = [];
		const created: string[] = [];
		try {
			for (const source of picked.filePaths) {
				const extension = path.extname(source).slice(1).toLowerCase();
				if (!audioExtensions.includes(extension) || !(await fs.stat(source)).isFile())
					throw new Error("Choose supported audio files.");
				const id = `${crypto.randomUUID()}.${extension}`,
					target = mediaPath(id);
				await fs.mkdir(path.dirname(target), { recursive: true });
				created.push(target);
				await fs.copyFile(source, target);
				result.push({ name: path.basename(source), url: `data-recruit-media:${id}` });
			}
			return result;
		} catch (error) {
			await Promise.all(
				created.map((target) =>
					fs.rm(target, { force: true }).catch(() => {
						/* Keep the original import error. */
					}),
				),
			);
			throw error;
		}
	});

	const audioJobs = new Map<string, AbortController>();
	const proxies = new Map<string, { target: string; cleanup: () => void }>();
	ipcMain.handle(
		"data-recruit:video-proxy",
		async (event, id: string, start: number, duration: number, job: string) => {
			const source = mediaPath(id);
			if (
				!Number.isFinite(start) ||
				start < 0 ||
				start > 86400 ||
				!Number.isFinite(duration) ||
				duration < 0.1 ||
				duration > 600 ||
				typeof job !== "string" ||
				!/^[a-z0-9-]{8,80}$/i.test(job)
			)
				throw new Error("Invalid video proxy request.");
			const key = `${event.sender.id}:${job}`;
			if (audioJobs.has(key)) throw new Error("Export job already running.");
			const controller = new AbortController(),
				abort = () => controller.abort();
			const proxyId = `${crypto.randomUUID()}.webm`,
				target = mediaPath(proxyId);
			audioJobs.set(key, controller);
			event.sender.once("destroyed", abort);
			try {
				const { createBookendVideoProxy } = await import("./data-recruit-media-video");
				await createBookendVideoProxy(source, target, start, duration, controller.signal);
				controller.signal.throwIfAborted();
				const proxyKey = `${event.sender.id}:${proxyId}`;
				const cleanup = () => {
					proxies.delete(proxyKey);
					void fs.rm(target, { force: true }).catch(() => {
						/* Best-effort shutdown cleanup. */
					});
				};
				proxies.set(proxyKey, { target, cleanup });
				event.sender.once("destroyed", cleanup);
				return `data-recruit-media:${proxyId}`;
			} catch (error) {
				await fs.rm(target, { force: true }).catch(() => {
					/* Preserve the decoder failure. */
				});
				throw error;
			} finally {
				audioJobs.delete(key);
				event.sender.removeListener("destroyed", abort);
			}
		},
	);
	ipcMain.handle("data-recruit:release-video-proxy", async (event, id: string) => {
		if (typeof id !== "string") return;
		const key = `${event.sender.id}:${id}`,
			proxy = proxies.get(key);
		if (!proxy) return;
		proxies.delete(key);
		event.sender.removeListener("destroyed", proxy.cleanup);
		await fs.rm(proxy.target, { force: true });
	});

	ipcMain.handle(
		"data-recruit:bookend-audio",
		async (event, id: string, start: number, duration: number, job: string) => {
			const target = mediaPath(id);
			if (
				!Number.isFinite(start) ||
				start < 0 ||
				start > 86400 ||
				!Number.isFinite(duration) ||
				duration < 0.1 ||
				duration > 600 ||
				typeof job !== "string" ||
				!/^[a-z0-9-]{8,80}$/i.test(job)
			)
				throw new Error("Invalid bookend audio request.");
			const key = `${event.sender.id}:${job}`;
			if (audioJobs.has(key)) throw new Error("Bookend audio job already running.");
			const controller = new AbortController(),
				abort = () => controller.abort();
			audioJobs.set(key, controller);
			event.sender.once("destroyed", abort);
			try {
				const { decodeBookendAudio } = await import("./data-recruit-media-audio");
				return await decodeBookendAudio(target, start, duration, controller.signal);
			} finally {
				audioJobs.delete(key);
				event.sender.removeListener("destroyed", abort);
			}
		},
	);
	ipcMain.handle("data-recruit:cancel-bookend-audio", (event, job: string) => {
		if (typeof job === "string") audioJobs.get(`${event.sender.id}:${job}`)?.abort();
	});

	ipcMain.handle("data-recruit:bookend-info", async (_event, id: string) => {
		const target = mediaPath(id);
		try {
			const stat = await fs.stat(target);
			if (!stat.isFile()) throw new Error("Not a file");
			return { size: stat.size, url: pathToFileURL(target).href };
		} catch {
			throw new Error("Imported media is missing on this computer. Add the file again.");
		}
	});
	ipcMain.handle(
		"data-recruit:read-bookend",
		async (_event, id: string, offset: number, length: number) => {
			const target = mediaPath(id);
			if (
				!Number.isSafeInteger(offset) ||
				offset < 0 ||
				!Number.isSafeInteger(length) ||
				length < 1 ||
				length > 4 * 1024 * 1024
			)
				throw new Error("Invalid bookend read range.");
			const handle = await fs.open(target, "r");
			try {
				const bytes = Buffer.allocUnsafe(length);
				const { bytesRead } = await handle.read(bytes, 0, length, offset);
				return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytesRead);
			} finally {
				await handle.close();
			}
		},
	);
}
