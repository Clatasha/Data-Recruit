export const SHORTCUT_ACTIONS = [
	"toggleSnapping",
	"toggleGuides",
	"fitTimeline",
	"cutSelected",
	"splitClip",
	"undo",
	"redo",
	"redoAlternate",
	"deleteAlternate",
	"deleteBackspace",
	"cycleAnnotationsForward",
	"cycleAnnotationsBackward",
	"frameBack",
	"frameForward",
	"saveProject",
	"saveProjectAs",
	"newProject",
	"openProject",
	"openShortcuts",
	"exportProject",

	"openApp",
	"addZoom",
	"addTrim",
	"addSpeed",
	"addCameraFullscreen",
	"addAnnotation",
	"addAudio",
	"addVoiceover",
	"deleteSelected",
	"playPause",
	"copySelected",
	"paste",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface ShortcutBinding {
	key: string;
	/** Maps to Cmd on macOS, Ctrl on Windows/Linux */
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export type ShortcutsConfig = Record<ShortcutAction, ShortcutBinding>;

export interface FixedShortcut {
	i18nKey: string;
	label: string;
	display: string;
	bindings: ShortcutBinding[];
}

export const FIXED_SHORTCUTS: FixedShortcut[] = [
	{ i18nKey: "undo", label: "Undo", display: "Ctrl + Z", bindings: [{ key: "z", ctrl: true }] },
	{
		i18nKey: "redo",
		label: "Redo",
		display: "Ctrl + Shift + Z / Ctrl + Y",
		bindings: [
			{ key: "z", ctrl: true, shift: true },
			{ key: "y", ctrl: true },
		],
	},
	{
		i18nKey: "cycleAnnotationsForward",
		label: "Cycle Annotations Forward",
		display: "Tab",
		bindings: [{ key: "tab" }],
	},
	{
		i18nKey: "cycleAnnotationsBackward",
		label: "Cycle Annotations Backward",
		display: "Shift + Tab",
		bindings: [{ key: "tab", shift: true }],
	},
	{
		i18nKey: "deleteSelectedAlt",
		label: "Delete Selected (alt)",
		display: "Del / ⌫",
		bindings: [{ key: "delete" }, { key: "backspace" }],
	},
	{
		i18nKey: "panTimeline",
		label: "Pan Timeline",
		display: "Scroll",
		bindings: [],
	},
	{ i18nKey: "zoomTimeline", label: "Zoom Timeline", display: "Ctrl + Scroll", bindings: [] },
	{ i18nKey: "frameBack", label: "Frame Back", display: "←", bindings: [{ key: "arrowleft" }] },
	{
		i18nKey: "frameForward",
		label: "Frame Forward",
		display: "→",
		bindings: [{ key: "arrowright" }],
	},
];

export type ShortcutConflict =
	| { type: "configurable"; action: ShortcutAction }
	| { type: "fixed"; label: string };

export function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
	return (
		a.key.toLowerCase() === b.key.toLowerCase() &&
		!!a.ctrl === !!b.ctrl &&
		!!a.shift === !!b.shift &&
		!!a.alt === !!b.alt
	);
}

export function findConflict(
	binding: ShortcutBinding,
	forAction: ShortcutAction,
	config: ShortcutsConfig,
): ShortcutConflict | null {
	if (!binding.key) return null;
	for (const action of SHORTCUT_ACTIONS) {
		if (action !== forAction && bindingsEqual(config[action], binding)) {
			return { type: "configurable", action };
		}
	}
	return null;
}

export const DEFAULT_SHORTCUTS: ShortcutsConfig = {
	toggleSnapping: { key: "g" },
	toggleGuides: { key: "g", ctrl: true, shift: true },
	fitTimeline: { key: "home" },
	cutSelected: { key: "x", ctrl: true },
	splitClip: { key: "b", ctrl: true },
	undo: { key: "z", ctrl: true },
	redo: { key: "z", ctrl: true, shift: true },
	redoAlternate: { key: "y", ctrl: true },
	deleteAlternate: { key: "delete" },
	deleteBackspace: { key: "backspace" },
	cycleAnnotationsForward: { key: "tab" },
	cycleAnnotationsBackward: { key: "tab", shift: true },
	frameBack: { key: "arrowleft" },
	frameForward: { key: "arrowright" },
	saveProject: { key: "s", ctrl: true },
	saveProjectAs: { key: "s", ctrl: true, shift: true },
	newProject: { key: "n", ctrl: true },
	openProject: { key: "o", ctrl: true },
	openShortcuts: { key: "?", shift: true },
	exportProject: { key: "e", ctrl: true },

	openApp: { key: "o", ctrl: true, shift: true },
	addZoom: { key: "z" },
	addTrim: { key: "t" },
	addSpeed: { key: "s" },
	addCameraFullscreen: { key: "c" },
	addAnnotation: { key: "a" },
	addAudio: { key: "m" },
	// Record a voiceover over the timeline from the playhead.
	addVoiceover: { key: "v" },
	deleteSelected: { key: "d", ctrl: true },
	playPause: { key: " " },
	copySelected: { key: "c", ctrl: true },
	paste: { key: "v", ctrl: true },
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
	toggleSnapping: "Toggle snapping",
	toggleGuides: "Toggle alignment guides",
	fitTimeline: "Fit timeline to window",
	cutSelected: "Cut Selected",
	splitClip: "Split clip at playhead",
	undo: "Undo",
	redo: "Redo",
	redoAlternate: "Redo (alternate)",
	deleteAlternate: "Delete Selected (Delete)",
	deleteBackspace: "Delete Selected (Backspace)",
	cycleAnnotationsForward: "Next Annotation",
	cycleAnnotationsBackward: "Previous Annotation",
	frameBack: "Previous Frame",
	frameForward: "Next Frame",
	saveProject: "Save Project",
	saveProjectAs: "Save Project As",
	newProject: "New Project",
	openProject: "Open Project",
	openShortcuts: "Keyboard Shortcuts",
	exportProject: "Export",

	openApp: "Open App",
	addZoom: "Add Zoom",
	addTrim: "Add Trim",
	addSpeed: "Add Speed",
	addCameraFullscreen: "Add Full Camera",
	addAnnotation: "Add Annotation",
	addAudio: "Add Audio",
	addVoiceover: "Record Voiceover",
	deleteSelected: "Delete Selected",
	playPause: "Play / Pause",
	copySelected: "Copy Selected",
	paste: "Paste",
};

export function matchesShortcut(
	e: KeyboardEvent,
	binding: ShortcutBinding | undefined,
	isMacPlatform: boolean,
): boolean {
	if (!binding?.key) return false;
	if (e.key.toLowerCase() !== binding.key.toLowerCase()) return false;

	const primaryMod = isMacPlatform ? e.metaKey : e.ctrlKey;
	if (primaryMod !== !!binding.ctrl) return false;
	if (e.shiftKey !== !!binding.shift) return false;
	if (e.altKey !== !!binding.alt) return false;

	return true;
}

/** True when the event target is a text-editing surface where shortcuts should not fire. */
export function isTextEditingTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	);
}

const KEY_LABELS: Record<string, string> = {
	" ": "Space",
	delete: "Del",
	backspace: "⌫",
	escape: "Esc",
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
};

export function formatBinding(binding: ShortcutBinding, isMac: boolean): string {
	if (!binding.key) return "Unassigned";
	const parts: string[] = [];
	if (binding.ctrl) parts.push(isMac ? "⌘" : "Ctrl");
	if (binding.shift) parts.push(isMac ? "⇧" : "Shift");
	if (binding.alt) parts.push(isMac ? "⌥" : "Alt");
	parts.push(KEY_LABELS[binding.key] ?? binding.key.toUpperCase());
	return parts.join(" + ");
}

/**
 * The label a fixed row shows. Rows bound to the primary modifier are built from their bindings,
 * so macOS gets ⌘ like the configurable rows; the rest keep their hand-written `display`.
 */
export function formatFixedShortcut(shortcut: FixedShortcut, isMac: boolean): string {
	if (!shortcut.bindings.some((binding) => binding.ctrl)) return shortcut.display;
	return shortcut.bindings.map((binding) => formatBinding(binding, isMac)).join(" / ");
}

/**
 * The chip a tooltip shows for a fixed shortcut: its first binding only. Redo has two
 * (Ctrl + Shift + Z, Ctrl + Y), and a tooltip names one, so the label a dialog row shows
 * (`formatFixedShortcut`) would be too long for it. `undefined` when the row has no binding.
 */
export function formatFirstFixedBinding(i18nKey: string, isMac: boolean): string | undefined {
	const first = FIXED_SHORTCUTS.find((shortcut) => shortcut.i18nKey === i18nKey)?.bindings[0];
	return first ? formatBinding(first, isMac) : undefined;
}

export function mergeWithDefaults(partial: Partial<ShortcutsConfig>): ShortcutsConfig {
	const merged = { ...DEFAULT_SHORTCUTS };
	const stored = partial && typeof partial === "object" ? partial : {};
	const valid = (binding: ShortcutBinding | undefined): binding is ShortcutBinding =>
		!!binding &&
		typeof binding.key === "string" &&
		[binding.ctrl, binding.shift, binding.alt].every(
			(value) => value === undefined || typeof value === "boolean",
		);
	for (const action of SHORTCUT_ACTIONS) {
		if (valid(stored[action])) merged[action] = { ...stored[action] };
	}
	for (const action of SHORTCUT_ACTIONS) {
		if (valid(stored[action]) || !merged[action].key) continue;
		if (
			SHORTCUT_ACTIONS.some(
				(other) =>
					other !== action &&
					valid(stored[other]) &&
					stored[other]?.key &&
					bindingsEqual(merged[action], stored[other]!),
			)
		)
			merged[action] = { key: "" };
	}
	return merged;
}
