import { Check, ChevronDown, Magnet, Maximize2, RotateCcw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { formatBinding } from "@/lib/shortcuts";
import { fitTimelineToWindow, useWorkspace, type WorkspacePreference } from "@/lib/workspace";
import { PreviewSettings } from "../PreviewSettings";
import styles from "./EditorShellV4.module.css";

export function WorkspaceMenu() {
	const t = useScopedT("editor");
	const workspace = useWorkspace();
	const { openConfig, shortcuts, isMac } = useShortcuts();
	const rows: WorkspacePreference[] = [
		"snapping",
		"showGuides",
		"snapToPlayhead",
		"snapToItems",
		"snapToClips",
		"showWaveforms",
	];
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button type="button" className={styles.workspaceTrigger}>
					<Magnet size={14} />
					<span>{t("workspace.title")}</span>
					<ChevronDown size={12} />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className={styles.workspaceMenu}>
				<div role="group" aria-label={t("workspace.title")}>
					{rows.map((key) => (
						<button
							type="button"
							key={key}
							className={styles.appMenuRow}
							role="switch"
							aria-checked={workspace[key]}
							onClick={() => workspace.toggle(key)}
						>
							<Check size={14} style={{ opacity: workspace[key] ? 1 : 0 }} />
							<span>{t(`workspace.${key}`)}</span>
							{key === "snapping" && shortcuts.toggleSnapping.key ? (
								<kbd>{formatBinding(shortcuts.toggleSnapping, isMac)}</kbd>
							) : null}
						</button>
					))}
				</div>
				<div className={styles.appMenuSep} />
				<PreviewSettings />
				<div className={styles.appMenuSep} />
				<button type="button" className={styles.appMenuRow} onClick={fitTimelineToWindow}>
					<Maximize2 size={14} />
					{t("workspace.fitTimeline")}
				</button>
				<button type="button" className={styles.appMenuRow} onClick={openConfig}>
					{t("workspace.shortcuts")}
				</button>
				<button type="button" className={styles.appMenuRow} onClick={workspace.reset}>
					<RotateCcw size={14} />
					{t("workspace.reset")}
				</button>
				<p className={styles.workspaceHint}>{t("workspace.snapHint")}</p>
			</PopoverContent>
		</Popover>
	);
}
