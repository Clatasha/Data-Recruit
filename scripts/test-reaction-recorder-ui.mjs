import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { expect as baseExpect } from "@playwright/test";
import { readRecordingProject } from "./recorder-smoke-project.mjs";

const expect = baseExpect.configure({ timeout: 30_000 });

import { _electron as electron } from "playwright";

const executablePath = path.resolve(process.argv[2]);
const output = path.resolve("release/recorder-preview");
await fs.mkdir(output, { recursive: true });
const application = await electron.launch({
	executablePath,
	env: { ...process.env, OPENSCREEN_DISABLE_CONTENT_PROTECTION: "1" },
	timeout: 60_000,
});
let editor;
let lastProxyStatus;
const editorErrors = [];
const mainOutput = [];
application.process().stderr?.on("data", (chunk) => mainOutput.push(String(chunk)));
try {
	const page = await application.firstWindow();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const dock = page.locator("[data-tray-layout]");
	await dock.waitFor({ timeout: 60_000 });
	await page.getByRole("button", { name: "Session controls", exact: true }).waitFor();
	await expect
		.poll(() =>
			application.evaluate(({ globalShortcut }) =>
				globalShortcut.isRegistered("CommandOrControl+Shift+S"),
			),
		)
		.toBe(true);
	const checkDockControls = async () => {
		const controls = [
			["Close", page.getByRole("button", { name: "Quit Reaction Station", exact: true })],
			["language", dock.getByRole("button").filter({ hasText: /^EN$/ })],
		];
		for (const [name, control] of controls) {
			// Vertical mode intentionally scrolls on shorter displays. Check the
			// control's visible position, rather than its offscreen content position.
			await control.scrollIntoViewIfNeeded();
			let geometry;
			try {
				await expect
					.poll(
						async () => {
							const surface = await dock.boundingBox();
							const button = await control.boundingBox();
							geometry = {
								surface,
								button,
								...(await dock.evaluate((el) => ({
									layout: el.getAttribute("data-tray-layout"),
									scrollTop: el.scrollTop,
									scrollHeight: el.scrollHeight,
									clientHeight: el.clientHeight,
								}))),
							};
							return Boolean(
								surface &&
									button &&
									button.x >= surface.x - 1 &&
									button.y >= surface.y - 1 &&
									button.x + button.width <= surface.x + surface.width + 1 &&
									button.y + button.height <= surface.y + surface.height + 1,
							);
						},
						{ message: `Recorder ${name} must be inside the dock` },
					)
					.toBe(true);
			} catch (error) {
				await page.screenshot({ path: path.join(output, "recorder-containment-failure.png") });
				throw new Error(`Recorder ${name} is outside the dock: ${JSON.stringify(geometry)}`, {
					cause: error,
				});
			}
		}
	};
	await checkDockControls();
	await page.getByTestId("launch-system-audio-button").click();
	await dock.screenshot({ path: path.join(output, "recorder-dock.png") });
	await page.getByRole("button", { name: "Session controls", exact: true }).click();
	const panel = page.getByRole("tabpanel");
	await panel.waitFor();
	const volume = page.getByRole("slider", { name: "System audio volume", exact: true });
	await expect(volume).toBeEnabled();
	for (let step = 0; step < 40; step += 1) await volume.press("ArrowLeft");
	await expect(volume).toHaveValue("60");
	await page
		.locator("[data-hud-interactive='true']")
		.filter({ has: page.getByRole("tablist") })
		.screenshot({ path: path.join(output, "audio-mixer.png") });
	await page.getByRole("tab", { name: "Hotkeys", exact: true }).click();
	if ((await panel.getByRole("combobox").count()) !== 8)
		throw new Error("Missing configurable hotkey controls");
	await page
		.locator("[data-hud-interactive='true']")
		.filter({ has: page.getByRole("tablist") })
		.screenshot({ path: path.join(output, "recording-hotkeys.png") });
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await page.getByRole("button", { name: "Switch to vertical bar", exact: true }).click();
	await page.locator("[data-tray-layout='vertical']").waitFor();
	await expect.poll(async () => (await dock.boundingBox())?.width ?? 1000).toBeLessThan(100);
	await checkDockControls();
	await dock.screenshot({ path: path.join(output, "vertical-dock.png") });
	if (errors.length) throw new Error(errors.join("\n"));
	const recordings = await application.evaluate(
		({ app }) => `${app.getPath("userData")}/recordings`,
	);
	await fs.mkdir(recordings, { recursive: true });
	const fixture = path.join(recordings, `reaction-audio-smoke-${Date.now()}.webm`);
	const ffmpeg = path.resolve("electron/native/bin/win32-x64/ffmpeg.exe");
	execFileSync(
		ffmpeg,
		[
			"-y",
			"-f",
			"lavfi",
			"-i",
			"color=c=0x242035:s=160x90:r=15",
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
			fixture,
		],
		{ stdio: "pipe" },
	);
	const audioSources = [];
	for (const [source, frequency] of [
		["microphone", 440],
		["desktop", 880],
	]) {
		const target = `${fixture}.${source}.wav`;
		execFileSync(
			ffmpeg,
			[
				"-y",
				"-f",
				"lavfi",
				"-i",
				`sine=frequency=${frequency}:sample_rate=48000`,
				"-t",
				"2",
				"-ac",
				"2",
				"-c:a",
				"pcm_s16le",
				target,
			],
			{ stdio: "pipe" },
		);
		audioSources.push({ path: target, source });
	}
	await page.evaluate(
		async ({ fixture, audioSources }) => {
			await window.electronAPI.setCurrentRecordingSession({
				screenVideoPath: fixture,
				audioSources,
				createdAt: Date.now(),
				cursorCaptureMode: "system",
			});
		},
		{ fixture, audioSources },
	);
	const editorWindow = application.waitForEvent("window");
	await page.getByTestId("launch-open-studio-button").click();
	editor = await editorWindow;
	editor.on("pageerror", (error) => editorErrors.push(error.message));
	editor.on("console", (message) => {
		if (message.text().startsWith("[library]")) editorErrors.push(message.text());
	});
	await editor.getByText("Microphone", { exact: true }).last().waitFor({ timeout: 60_000 });
	await editor.getByText("Desktop audio", { exact: true }).last().waitFor({ timeout: 60_000 });
	const projectsDirectory = path.join(path.dirname(recordings), "projects");
	let importedProjectFile;
	const getImportedDocument = async () => {
		const saved = await readRecordingProject(projectsDirectory, fixture, importedProjectFile);
		if (saved) importedProjectFile = saved.file;
		return saved?.document ?? null;
	};
	await expect
		.poll(async () => (await getImportedDocument())?.audioTracks?.length ?? 0, {
			timeout: 60_000,
			message: "Both recording audio sources must persist",
		})
		.toBe(2);
	const document = await getImportedDocument();
	if (!document.assets.find((asset) => asset.kind === "video")?.sourceAudioMuted)
		throw new Error("Embedded recording mix was not suppressed");
	if (
		!document.audioTracks.every(
			(track) => track.startMs === 0 && track.endMs === 2000 && track.gainDb === 0,
		)
	)
		throw new Error("Separate recording sources did not share the capture clock");
	await editor.getByText("Microphone", { exact: true }).last().click();
	await editor.getByRole("slider").first().waitFor();
	await editor.screenshot({ path: path.join(output, "separate-audio-editor.png") });
	const quality = editor.getByRole("combobox", { name: "Preview quality", exact: true });
	await quality.selectOption("quarter");
	await expect(quality).toHaveValue("quarter");
	await quality.selectOption("auto");
	const qualityBox = await quality.boundingBox();
	const recordBox = await editor.getByRole("tab", { name: "Record", exact: true }).boundingBox();
	if (!qualityBox || !recordBox || qualityBox.x < recordBox.x + recordBox.width)
		throw new Error("Preview quality must be beside the mode controls");
	await editor.getByRole("button", { name: "Workspace", exact: true }).click();
	const proxies = editor.getByRole("checkbox", {
		name: "Use lightweight editing copies (720p)",
		exact: true,
	});
	await proxies.check();
	// Report the encoder's failure directly rather than timing out on a
	// missing label. This invokes the same cached job the UI is polling.
	await expect
		.poll(
			async () => {
				const status = await editor.evaluate(
					({ fixture }) => window.electronAPI.preparePreviewProxy(fixture, 2),
					{ fixture },
				);
				lastProxyStatus = status;
				if (status.state === "error")
					throw new Error(`Packaged proxy preparation failed: ${status.message}`);
				return status.state;
			},
			{ timeout: 60_000, message: "Packaged FFmpeg must prepare the editing copy" },
		)
		.toBe("ready");
	await expect(editor.getByText(/Editing copy ready/)).toBeVisible({ timeout: 10_000 });
	await proxies.uncheck();
	const snapping = editor.getByRole("switch", { name: /Enable snapping/ });
	await expect(snapping).toHaveAttribute("aria-checked", "true");
	await snapping.click();
	await expect(snapping).toHaveAttribute("aria-checked", "false");
	await snapping.click();
	await editor.screenshot({ path: path.join(output, "workspace-menu.png") });
	await editor.keyboard.press("Escape");
	const microphone = editor
		.locator('[data-timeline-kind="audio"]')
		.filter({ hasText: "Microphone" })
		.first();
	const tracks = editor.locator('[class*="tlTracks_"]').first();
	const originalTracksHeight = await tracks.evaluate((el) => el.clientHeight);
	const originalTrackCount = await editor.locator("[data-editor-track-id]").count();
	await microphone.click({ button: "right" });
	await editor.screenshot({ path: path.join(output, "timeline-before-duplicate.png") });
	await editor.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
	await expect.poll(async () => (await getImportedDocument()).audioTracks.length).toBe(3);
	await expect.poll(() => tracks.evaluate((el) => el.clientHeight)).toBe(originalTracksHeight);
	await expect(tracks).toHaveCSS("overflow-y", "auto");
	await expect(tracks).toHaveCSS("scrollbar-width", "auto");
	const copied = (await getImportedDocument()).audioTracks.find(
		(track) => !document.audioTracks.some((original) => original.id === track.id),
	);
	const copiedId = copied.trackId ?? copied.id;
	await editor
		.locator(`[data-timeline-kind="audio"][data-timeline-id="${copiedId}"]`)
		.click({ button: "right" });
	// Keep the full audio menu through dismissal; dropping these rows used to
	// move Delete under the pointer before the click finished.
	await expect(editor.getByRole("menuitem", { name: "Rename item", exact: true })).toBeVisible();
	await expect(editor.getByRole("menuitem", { name: "Disable item", exact: true })).toBeVisible();
	await expect(editor.getByRole("menuitem", { name: "Mute audio", exact: true })).toBeVisible();
	await expect(editor.getByRole("menuitem", { name: "Delete", exact: true })).toBeEnabled();
	await editor.screenshot({ path: path.join(output, "timeline-context-menu.png") });
	await editor.getByRole("menuitem", { name: "Delete", exact: true }).click();
	await expect.poll(async () => (await getImportedDocument()).audioTracks.length).toBe(2);
	await expect
		.poll(() => editor.locator("[data-editor-track-id]").count())
		.toBe(originalTrackCount);

	const trackOrder = await editor.locator("[data-editor-track-id]").evaluateAll((rows) =>
		rows.slice(-3).map((row) => ({
			id: row.dataset.editorTrackId,
			audio: row.querySelector('[data-timeline-kind="audio"]')?.textContent ?? "",
		})),
	);
	expect(trackOrder[0].id).toBe("main-video");
	expect(trackOrder[1].audio).toContain("Desktop audio");
	expect(trackOrder[2].audio).toContain("Microphone");
	const lanesBeforeAdd = await editor.locator("[data-editor-track-id]").count();
	await editor.getByTitle("Add audio track", { exact: true }).click();
	await expect
		.poll(() => editor.locator("[data-editor-track-id]").count())
		.toBe(lanesBeforeAdd + 1);
	const addedLane = (await getImportedDocument()).timeline.tracks.find(
		(track) => track.autoCreated === false && track.kind === "audio",
	);
	await editor
		.locator(`[data-editor-track-id="${addedLane.id}"]`)
		.getByRole("button", { name: "Remove track", exact: true })
		.click();
	await expect.poll(() => editor.locator("[data-editor-track-id]").count()).toBe(lanesBeforeAdd);
	const bin = editor.getByTestId("media-bin");
	await expect(bin).toBeVisible();
	await expect
		.poll(() =>
			bin.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
		)
		.toBe(3);
	await bin.getByRole("button").first().click({ button: "right" });
	await expect(editor.getByRole("menuitem", { name: "Locate file", exact: true })).toBeVisible();
	await expect(editor.getByRole("menuitem", { name: "Replace file", exact: true })).toBeVisible();
	await expect(editor.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
	await editor.screenshot({ path: path.join(output, "library-context-menu.png") });
	await editor.keyboard.press("Escape");
	const micRow = editor
		.locator("[data-editor-track-id]")
		.filter({
			has: editor.locator('[data-timeline-kind="audio"]').filter({ hasText: "Microphone" }),
		})
		.first();
	const micTrackId = await micRow.getAttribute("data-editor-track-id");
	// Old projects have no persisted track settings until the first control edit.
	// Poll the exact row without throwing during the asynchronous document save.
	const savedMicTrack = async () =>
		(await getImportedDocument())?.timeline?.tracks?.find((track) => track.id === micTrackId);
	await micRow.getByRole("button", { name: "Lock track", exact: true }).click();
	await expect.poll(async () => (await savedMicTrack())?.locked).toBe(true);
	await micRow.getByRole("button", { name: "Unlock track", exact: true }).click();
	await expect.poll(async () => (await savedMicTrack())?.locked).toBe(false);
	await micRow.getByRole("button", { name: "Mute track", exact: true }).click();
	await expect.poll(async () => (await savedMicTrack())?.muted).toBe(true);
	await micRow.getByRole("button", { name: "Unmute track", exact: true }).click();
	await expect.poll(async () => (await savedMicTrack())?.muted).toBe(false);
	await microphone.click({ button: "right" });
	await editor.getByRole("menuitem", { name: "Disable item", exact: true }).click();
	await expect
		.poll(async () =>
			(await getImportedDocument())?.audioTracks?.some(
				(track) => track.recordingSource === "microphone" && track.disabled,
			),
		)
		.toBe(true);
	await microphone.click({ button: "right" });
	await editor.getByRole("menuitem", { name: "Enable item", exact: true }).click();
	await expect
		.poll(async () =>
			(await getImportedDocument())?.audioTracks?.some(
				(track) => track.recordingSource === "microphone" && track.disabled,
			),
		)
		.toBe(false);
	await editor.screenshot({ path: path.join(output, "library-track-controls.png") });
	await editor
		.locator('[data-timeline-kind="audio"]')
		.filter({ hasText: "Microphone" })
		.first()
		.click();
	await editor.getByLabel("Use this audio to lower all other audio", { exact: true }).click();
	await expect
		.poll(
			async () =>
				(await getImportedDocument())?.audioTracks?.find(
					(track) => track.recordingSource === "microphone",
				)?.duckingTrigger?.enabled,
		)
		.toBe(true);
	const reduction = editor.getByRole("slider", { name: "Lower other audio by", exact: true });
	await reduction.press("End");
	await reduction.press("Tab");
	await expect
		.poll(
			async () =>
				(await getImportedDocument())?.audioTracks?.find(
					(track) => track.recordingSource === "microphone",
				)?.duckingTrigger?.reductionPercent,
		)
		.toBe(100);
	await editor.screenshot({ path: path.join(output, "audio-ducking.png") });
	const stickerPath = path.join(recordings, "reaction-sticker-smoke.png");
	await fs.writeFile(
		stickerPath,
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALElEQVR4nO3OsREAAAQEQf03jQ4EImZ3/vOLABhkb3MBAgQIECBAwP0A4L0C4RD+EDWrAHUAAAAASUVORK5CYII=",
			"base64",
		),
	);
	await editor.getByRole("tab", { name: "Stickers", exact: true }).click();
	await application.evaluate(({ dialog }, filePath) => {
		const original = dialog.showOpenDialog;
		dialog.showOpenDialog = async () => {
			dialog.showOpenDialog = original;
			return { canceled: false, filePaths: [filePath] };
		};
	}, stickerPath);
	await editor.getByTitle("Import media", { exact: true }).click();
	await expect
		.poll(
			async () => {
				const asset = (await getImportedDocument())?.assets?.find(
					(asset) => asset.stillImagePath === stickerPath,
				);
				const errors = await editor
					.locator("[data-sonner-toast][data-type='error']")
					.allTextContents();
				if (errors.length) throw new Error(`Sticker import: ${errors.join("; ")}`);
				return asset?.libraryCategory;
			},
			{ timeout: 60_000, message: "Native sticker import must persist in the sticker bin" },
		)
		.toBe("sticker");
	const sticker = editor.getByTitle("reaction-sticker-smoke.png", { exact: true });
	await expect(sticker).toHaveAttribute("draggable", "true", { timeout: 60_000 });
	const beforeStickers = (await getImportedDocument()).annotations.length;
	const transfer = await editor.evaluateHandle(() => new DataTransfer());
	await sticker.dispatchEvent("dragstart", { dataTransfer: transfer });
	// Chromium may append an image-file payload to an internal asset drag.
	await transfer.evaluate((data) =>
		data.items.add(new File(["thumbnail"], "thumbnail.png", { type: "image/png" })),
	);
	const dropRect = await tracks.boundingBox();
	await tracks.dispatchEvent("drop", {
		dataTransfer: transfer,
		clientX: dropRect.x + dropRect.width * 0.25,
		clientY: dropRect.y + 20,
	});
	await transfer.dispose();
	await expect
		.poll(async () => (await getImportedDocument()).annotations.length)
		.toBe(beforeStickers + 1);
	const stickerDocument = await getImportedDocument();
	const stickerAsset = stickerDocument.assets.find((asset) => asset.stillImagePath === stickerPath);
	const stickerItem = stickerDocument.annotations.find(
		(item) => item.mediaAssetId === stickerAsset?.id,
	);
	if (!stickerItem?.editorTrackId) throw new Error("Sticker drop did not create its visual track");
	await expect(editor.locator(`[data-editor-track-id="${stickerItem.editorTrackId}"]`)).toHaveCount(
		1,
	);
	await editor.screenshot({ path: path.join(output, "transparent-sticker-drop.png") });

	// Timeline utility settings and marker edits use the real packaged project.
	const transport = editor.getByRole("toolbar", { name: "Playback controls", exact: true });
	const toolbar = editor.getByTestId("timeline-toolbar");
	const transportBox = await transport.boundingBox();
	const toolbarBox = await toolbar.boundingBox();
	if (
		!transportBox ||
		!toolbarBox ||
		Math.abs(transportBox.x + transportBox.width / 2 - toolbarBox.x - toolbarBox.width / 2) > 2
	)
		throw new Error("Playback and time must stay centred in the timeline toolbar");
	const monitor = editor.getByRole("slider", {
		name: "Preview volume (export unchanged)",
		exact: true,
	});
	const volumeTrack = await monitor.evaluate((element) => ({
		width: element.getBoundingClientRect().width,
		height: element.getBoundingClientRect().height,
		background: getComputedStyle(element).backgroundColor,
	}));
	if (
		volumeTrack.width < 50 ||
		volumeTrack.height < 4 ||
		volumeTrack.background === "rgba(0, 0, 0, 0)"
	)
		throw new Error("Preview volume must have a visible track");
	await monitor.press("Home");
	await expect(monitor).toHaveValue("0");
	await monitor.press("End");
	await expect(monitor).toHaveValue("100");
	const beforeMarkers = (await getImportedDocument()).markers?.length ?? 0;
	await editor.getByRole("button", { name: "Add marker at playhead", exact: true }).click();
	await expect
		.poll(async () => (await getImportedDocument()).markers?.length ?? 0)
		.toBe(beforeMarkers + 1);
	await editor.locator('[data-timeline-kind="marker"]').last().click({ button: "right" });
	await editor.getByLabel("Marker name", { exact: true }).fill("Reaction begins");
	await editor.getByRole("button", { name: "Purple", exact: true }).click();
	await editor.getByRole("button", { name: "Save", exact: true }).click();
	await expect
		.poll(async () =>
			(await getImportedDocument()).markers?.some(
				(m) => m.name === "Reaction begins" && m.color === "purple",
			),
		)
		.toBe(true);
	await editor
		.getByRole("button", { name: "Reaction begins", exact: true })
		.click({ button: "right" });
	await editor.getByRole("button", { name: "Delete marker", exact: true }).click();
	await expect
		.poll(async () => (await getImportedDocument()).markers?.length ?? 0)
		.toBe(beforeMarkers);
	await editor.getByRole("button", { name: "Add voiceover", exact: true }).click();
	const voiceover = editor.getByRole("dialog", { name: "Add voiceover", exact: true });
	await expect(voiceover.getByRole("combobox", { name: "Microphone", exact: true })).toBeVisible();
	await expect(
		voiceover.getByRole("checkbox", { name: "Mute project while recording", exact: true }),
	).toBeChecked();
	await voiceover
		.getByRole("checkbox", { name: "Mute project while recording", exact: true })
		.uncheck();
	await editor.screenshot({ path: path.join(output, "voiceover-popup.png") });
	await voiceover.getByRole("button", { name: "Close", exact: true }).click();
	await editor
		.locator('canvas[data-testid="native-compositor-mount"][data-painted="true"]')
		.waitFor({ timeout: 60_000 });
	await expect(editor.getByTestId("preview-preparing")).toBeHidden({ timeout: 60_000 });
	const screenshotPath = path.join(output, "saved-preview.png");
	await application.evaluate(({ dialog }, target) => {
		const original = dialog.showSaveDialog;
		dialog.showSaveDialog = async () => {
			dialog.showSaveDialog = original;
			return { canceled: false, filePath: target };
		};
	}, screenshotPath);
	await editor.getByRole("button", { name: "Save preview screenshot", exact: true }).click();
	await expect
		.poll(async () => {
			try {
				return (await fs.readFile(screenshotPath)).subarray(0, 8).toString("hex");
			} catch {
				return "";
			}
		})
		.toBe("89504e470d0a1a0a");
	console.log(
		"Packaged timeline markers persist edits/deletion; preview volume, voice-over settings and PNG snapshot work.",
	);
	console.log(
		"Packaged Library has three columns; lock, mute, disable, and enable persist correctly.",
	);

	console.log(
		"Packaged editor imported and persisted both synchronized audio sources with the fallback mix suppressed.",
	);
	await expect
		.poll(() =>
			application.evaluate(({ globalShortcut }) =>
				globalShortcut.isRegistered("CommandOrControl+Shift+S"),
			),
		)
		.toBe(false);
	console.log(
		"Packaged recorder UI smoke passed. Native capture and OS click-through require desktop testing.",
	);
} catch (error) {
	if (editor && !editor.isClosed()) {
		await editor.screenshot({ path: path.join(output, "editor-failure.png") }).catch(() => {
			/* Preserve the original test failure if screenshot capture fails. */
		});
		console.error(
			"Editor diagnostics:",
			JSON.stringify({
				errors: editorErrors,
				mainOutput: mainOutput.join("").slice(-12000),
				proxyStatus: lastProxyStatus,
				toasts: await editor
					.locator("[data-sonner-toast]")
					.allTextContents()
					.catch(() => []),
				projects: await editor
					.evaluate(async () => {
						const list = await window.electronAPI.invokeNativeBridge({
							domain: "aiEdition",
							action: "document.listProjects",
							requestId: crypto.randomUUID(),
						});
						return Promise.all(
							(list.data ?? []).map(async (project) => {
								const result = await window.electronAPI.invokeNativeBridge({
									domain: "aiEdition",
									action: "document.get",
									payload: { projectId: project.id },
									requestId: crypto.randomUUID(),
								});
								return {
									id: project.id,
									audioTracks: result.data?.document?.audioTracks?.length,
									error: result.error,
								};
							}),
						);
					})
					.catch(() => []),
				menus: await editor
					.getByRole("menu")
					.allTextContents()
					.catch(() => []),
				audioPills: await editor
					.locator('[data-timeline-kind="audio"]')
					.evaluateAll((items) =>
						items.map((item) => ({ id: item.dataset.timelineId, label: item.textContent })),
					)
					.catch(() => []),
			}),
		);
	}
	throw error;
} finally {
	await application.close();
}
