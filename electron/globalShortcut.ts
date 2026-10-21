import fs from "node:fs/promises";
import { globalShortcut } from "electron";
import { type ShortcutBinding } from "../src/lib/shortcuts";
import { SHORTCUTS_FILE } from "./ipc/handlers";

const DEFAULT_OPEN_APP_BINDING: ShortcutBinding = { key: "o", ctrl: true, shift: true };

export { bindingToAccelerator } from "../src/lib/shortcutAccelerator";

import { bindingToAccelerator } from "../src/lib/shortcutAccelerator";

let currentAccelerator: string | null = null;

export function registerOpenAppShortcut(binding: ShortcutBinding, onTrigger: () => void): boolean {
	if (!binding.key) {
		if (currentAccelerator) globalShortcut.unregister(currentAccelerator);
		currentAccelerator = null;
		return true;
	}
	const accelerator = bindingToAccelerator(binding);

	if (accelerator === currentAccelerator) {
		return true;
	}

	// Register the new shortcut before unregistering the old, so a failure leaves the old binding intact
	const success = globalShortcut.register(accelerator, onTrigger);

	if (success) {
		if (currentAccelerator) {
			globalShortcut.unregister(currentAccelerator);
		}
		currentAccelerator = accelerator;
		console.log(`Global shortcut registered: ${accelerator}`);
	} else {
		console.warn(`Failed to register global shortcut: ${accelerator}`);
	}

	return success;
}

export async function loadAndRegisterGlobalShortcut(onTrigger: () => void): Promise<void> {
	try {
		const data = await fs.readFile(SHORTCUTS_FILE, "utf-8");
		const shortcuts = JSON.parse(data);
		const binding = shortcuts.openApp || DEFAULT_OPEN_APP_BINDING;
		registerOpenAppShortcut(binding, onTrigger);
	} catch {
		registerOpenAppShortcut(DEFAULT_OPEN_APP_BINDING, onTrigger);
	}
}

export function unregisterAllGlobalShortcuts(): void {
	globalShortcut.unregisterAll();
}
