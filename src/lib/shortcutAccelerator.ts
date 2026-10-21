import type { ShortcutBinding } from "./shortcuts";

// Maps KeyboardEvent.key values to Electron accelerator key names
const KEY_TO_ACCELERATOR: Record<string, string> = {
	" ": "Space",
	"+": "Plus",
	"-": "numsub",
	"*": "nummult",
	"/": "numdiv",
	arrowup: "Up",
	arrowdown: "Down",
	arrowleft: "Left",
	arrowright: "Right",
	escape: "Escape",
	enter: "Return",
	backspace: "Backspace",
	delete: "Delete",
	tab: "Tab",
};

export function bindingToAccelerator(binding: ShortcutBinding): string {
	if (!binding.key) return "";
	const parts: string[] = [];
	if (binding.ctrl) parts.push("CommandOrControl");
	if (binding.shift) parts.push("Shift");
	if (binding.alt) parts.push("Alt");

	const keyLower = binding.key.toLowerCase();
	const acceleratorKey = KEY_TO_ACCELERATOR[keyLower] ?? binding.key.toUpperCase();
	parts.push(acceleratorKey);

	return parts.join("+");
}
