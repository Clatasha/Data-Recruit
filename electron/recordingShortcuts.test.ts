import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECORDING_SHORTCUTS } from "../src/lib/recorderControls";

const mocks = vi.hoisted(() => ({
	callbacks: new Map<string, () => void>(),
	occupied: new Set<string>(),
	write: vi.fn(async () => undefined),
}));
vi.mock("electron", () => ({
	app: { getPath: () => "/fake" },
	globalShortcut: {
		register: (key: string, callback: () => void) => {
			if (mocks.callbacks.has(key) || mocks.occupied.has(key)) return false;
			mocks.callbacks.set(key, callback);
			return true;
		},
		unregister: (key: string) => mocks.callbacks.delete(key),
	},
}));
vi.mock("node:fs/promises", () => ({
	default: {
		readFile: vi.fn(async () => {
			throw new Error("No saved settings");
		}),
		writeFile: mocks.write,
		rename: vi.fn(async () => undefined),
	},
}));
vi.mock("./ipc/handlers", () => ({ SHORTCUTS_FILE: "/fake/shortcuts.json" }));
beforeEach(() => {
	vi.resetModules();
	mocks.callbacks.clear();
	mocks.occupied.clear();
	mocks.write.mockReset().mockResolvedValue(undefined);
});
describe("recording global shortcuts", () => {
	it("works outside the renderer and swaps actions without stale callbacks", async () => {
		const engine = await import("./recordingShortcuts");
		const action = vi.fn();
		await engine.initializeRecordingShortcuts(action);
		mocks.callbacks.get("CommandOrControl+Shift+R")?.();
		expect(action).toHaveBeenLastCalledWith("record");
		const swapped = {
			...DEFAULT_RECORDING_SHORTCUTS,
			record: DEFAULT_RECORDING_SHORTCUTS.pause,
			pause: DEFAULT_RECORDING_SHORTCUTS.record,
		};
		expect(engine.registerRecordingShortcuts(swapped)).toBe(true);
		mocks.callbacks.get("CommandOrControl+Shift+R")?.();
		expect(action).toHaveBeenLastCalledWith("pause");
	});
	it("preserves all old bindings and disk settings when any new binding is occupied", async () => {
		const engine = await import("./recordingShortcuts");
		await engine.initializeRecordingShortcuts(vi.fn());
		mocks.occupied.add("CommandOrControl+Shift+Y");
		const next = {
			...DEFAULT_RECORDING_SHORTCUTS,
			record: { key: "x", ctrl: true, shift: true },
			pause: { key: "y", ctrl: true, shift: true },
		};
		expect((await engine.saveRecordingShortcuts(next)).success).toBe(false);
		expect(mocks.callbacks.size).toBe(4);
		expect(mocks.callbacks.has("CommandOrControl+Shift+R")).toBe(true);
		expect(mocks.callbacks.has("CommandOrControl+Shift+X")).toBe(false);
		expect(mocks.write).not.toHaveBeenCalled();
	});
	it("rejects duplicates and bare letters without registering anything", async () => {
		const engine = await import("./recordingShortcuts");
		expect(
			engine.registerRecordingShortcuts({
				...DEFAULT_RECORDING_SHORTCUTS,
				pause: DEFAULT_RECORDING_SHORTCUTS.record,
			}),
		).toBe(false);
		expect(
			engine.registerRecordingShortcuts({ ...DEFAULT_RECORDING_SHORTCUTS, record: { key: "r" } }),
		).toBe(false);
		expect(mocks.callbacks.size).toBe(0);
	});
	it("restores old bindings if saving to disk fails", async () => {
		const engine = await import("./recordingShortcuts");
		await engine.initializeRecordingShortcuts(vi.fn());
		mocks.write.mockRejectedValueOnce(new Error("Disk full"));
		expect(
			(
				await engine.saveRecordingShortcuts({
					...DEFAULT_RECORDING_SHORTCUTS,
					record: { key: "x", ctrl: true },
				})
			).success,
		).toBe(false);
		expect(mocks.callbacks.has("CommandOrControl+Shift+R")).toBe(true);
		expect(mocks.callbacks.has("CommandOrControl+X")).toBe(false);
	});
	it("releases recording keys for editing and restores the configured actions when the HUD returns", async () => {
		const engine = await import("./recordingShortcuts");
		const trigger = vi.fn();
		await engine.initializeRecordingShortcuts(trigger);
		const next = { ...DEFAULT_RECORDING_SHORTCUTS, record: { key: "x", ctrl: true, shift: true } };
		expect((await engine.saveRecordingShortcuts(next)).success).toBe(true);
		mocks.callbacks.set("CommandOrControl+Shift+O", () => undefined);
		engine.deactivateRecordingShortcuts();
		expect([...mocks.callbacks.keys()]).toEqual(["CommandOrControl+Shift+O"]);
		engine.activateRecordingShortcuts();
		mocks.callbacks.get("CommandOrControl+Shift+X")?.();
		expect(trigger).toHaveBeenLastCalledWith("record");
		expect(mocks.callbacks.has("CommandOrControl+Shift+R")).toBe(false);
	});
});

it("uses explicit Stop for an active take, including paused recording, while retaining idle Start and other actions", async () => {
	const engine = await import("./recordingShortcuts");
	const send = vi.fn();
	engine.dispatchRecordingShortcut("record", true, send);
	expect(send).toHaveBeenLastCalledWith("stop-recording-from-tray");
	engine.dispatchRecordingShortcut("record", false, send);
	expect(send).toHaveBeenLastCalledWith("recording-shortcut", "record");
	engine.dispatchRecordingShortcut("pause", true, send);
	expect(send).toHaveBeenLastCalledWith("recording-shortcut", "pause");
});
