import fs from "node:fs/promises";
import path from "node:path";
import { app, globalShortcut } from "electron";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	RECORDING_ACTIONS,
	type RecordingAction,
	type RecordingShortcuts,
	validRecordingShortcuts,
} from "../src/lib/recorderControls";
import { bindingToAccelerator } from "./globalShortcut";

let registered = new Map<string, RecordingAction>();
let configured = DEFAULT_RECORDING_SHORTCUTS;
let initialized = false;
let trigger: (action: RecordingAction) => void = () => {
	/* Installed when the GUI starts. */
};
const settingsPath = () => path.join(app.getPath("userData"), "recording-shortcuts.json");

// Keep old accelerators reserved until both registration and persistence succeed.
function prepareRecordingShortcuts(config: RecordingShortcuts) {
	if (!validRecordingShortcuts(config)) return null;
	const next = new Map(
		RECORDING_ACTIONS.map((action) => [bindingToAccelerator(config[action]), action]),
	);
	if (next.size !== RECORDING_ACTIONS.length) return null;
	const acquired: string[] = [];
	const rollback = () => {
		for (const accelerator of acquired) globalShortcut.unregister(accelerator);
	};
	try {
		for (const accelerator of next.keys()) {
			if (registered.has(accelerator)) continue;
			if (
				!globalShortcut.register(accelerator, () => {
					const action = registered.get(accelerator);
					if (action) trigger(action);
				})
			)
				throw new Error("Shortcut unavailable");
			acquired.push(accelerator);
		}
	} catch {
		rollback();
		return null;
	}
	return {
		rollback,
		commit: () => {
			for (const accelerator of registered.keys())
				if (!next.has(accelerator)) globalShortcut.unregister(accelerator);
			registered = next;
			configured = config;
		},
	};
}
export function registerRecordingShortcuts(config: RecordingShortcuts): boolean {
	const transaction = prepareRecordingShortcuts(config);
	if (!transaction) return false;
	transaction.commit();
	return true;
}

export async function loadRecordingShortcuts(): Promise<RecordingShortcuts> {
	try {
		const saved: unknown = JSON.parse(await fs.readFile(settingsPath(), "utf-8"));
		if (validRecordingShortcuts(saved)) return saved;
	} catch {
		/* First launch uses defaults. */
	}
	return DEFAULT_RECORDING_SHORTCUTS;
}
export function deactivateRecordingShortcuts() {
	for (const accelerator of registered.keys()) globalShortcut.unregister(accelerator);
	registered.clear();
}
export function activateRecordingShortcuts() {
	if (!initialized || registered.size) return;
	// One occupied shortcut must not disable the other recording controls.
	for (const action of RECORDING_ACTIONS) {
		const accelerator = bindingToAccelerator(configured[action]);
		try {
			if (
				globalShortcut.register(accelerator, () => {
					const current = registered.get(accelerator);
					if (current) trigger(current);
				})
			)
				registered.set(accelerator, action);
			else console.warn(`Recording shortcut unavailable: ${accelerator}`);
		} catch {
			console.warn(`Invalid recording shortcut: ${accelerator}`);
		}
	}
}
export async function initializeRecordingShortcuts(onAction: (action: RecordingAction) => void) {
	trigger = onAction;
	configured = await loadRecordingShortcuts();
	initialized = true;
	activateRecordingShortcuts();
}
let saving = false;
export async function saveRecordingShortcuts(config: RecordingShortcuts) {
	if (saving) return { success: false, error: "Another shortcut save is in progress." };
	const transaction = prepareRecordingShortcuts(config);
	if (!transaction)
		return {
			success: false,
			error: "One of these shortcuts is already in use. Choose a different combination.",
		};
	saving = true;
	try {
		const temporary = `${settingsPath()}.tmp`;
		await fs.writeFile(temporary, JSON.stringify(config, null, 2), "utf-8");
		await fs.rename(temporary, settingsPath());
		transaction.commit();
		return { success: true };
	} catch {
		transaction.rollback();
		return { success: false, error: "Could not save recording shortcuts." };
	} finally {
		saving = false;
	}
}

/** An active take always gets the explicit Stop command, irrespective of renderer state. */
export function dispatchRecordingShortcut(
	action: RecordingAction,
	recording: boolean,
	send: (channel: string, ...args: unknown[]) => void,
) {
	if (action === "record" && recording) send("stop-recording-from-tray");
	else send("recording-shortcut", action);
}
