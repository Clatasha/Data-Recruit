import { Keyboard, Mic, SlidersHorizontal, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useScopedT } from "@/contexts/I18nContext";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	RECORDING_ACTIONS,
	type RecordingShortcuts,
} from "@/lib/recorderControls";
import styles from "./LaunchWindow.module.css";

const KEYS = [
	..."abcdefghijklmnopqrstuvwxyz0123456789",
	...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
];
export function RecorderMixer({
	levels,
	muted,
	microphoneEnabled,
	systemEnabled,
	available,
	locked,
	recording,
	onLevel,
	onMute,
	onClose,
	panelRef,
}: {
	levels: { microphone: number; system: number };
	muted: { microphone: boolean; system: boolean };
	microphoneEnabled: boolean;
	systemEnabled: boolean;
	available: boolean;
	locked: boolean;
	recording: boolean;
	onLevel: (channel: "microphone" | "system", value: number) => void;
	onMute: (channel: "microphone" | "system") => void;
	onClose: () => void;
	panelRef: (element: HTMLDivElement | null) => void;
}) {
	const t = useScopedT("launch");
	const tc = useScopedT("common");
	const [tab, setTab] = useState<"audio" | "hotkeys">("audio");
	const [config, setConfig] = useState<RecordingShortcuts>(DEFAULT_RECORDING_SHORTCUTS);
	const [saving, setSaving] = useState(false);
	const [isMac, setIsMac] = useState(false);
	useEffect(() => {
		let cancelled = false;
		window.electronAPI
			?.getRecordingShortcuts?.()
			.then((saved) => {
				if (!cancelled) setConfig(saved);
			})
			.catch(() => {
				/* Keep defaults when settings are unavailable. */
			});
		setIsMac(window.electronAPI?.getPlatform?.() === "darwin");
		return () => {
			cancelled = true;
		};
	}, []);
	const save = async () => {
		setSaving(true);
		try {
			const result = await window.electronAPI?.saveRecordingShortcuts?.(config);
			if (!result?.success) toast.error(result?.error ?? t("reaction.shortcutsFailed"));
			else {
				toast.success(t("reaction.shortcutsSaved"));
				onClose();
			}
		} catch {
			toast.error(t("reaction.shortcutsFailed"));
		} finally {
			setSaving(false);
		}
	};
	return (
		<div
			ref={panelRef}
			data-hud-interactive="true"
			className={`${styles.hudModal} ${styles.recorderPanel} ${styles.electronNoDrag}`}
		>
			<header className={styles.panelHeader}>
				<span>{t("reaction.sessionControls")}</span>
				<button type="button" aria-label={tc("actions.close")} onClick={onClose}>
					<X size={16} />
				</button>
			</header>
			<div className={styles.panelTabs} role="tablist" aria-label={t("reaction.sessionControls")}>
				<button
					id="recorder-audio-tab"
					role="tab"
					aria-controls="recorder-panel"
					aria-selected={tab === "audio"}
					onClick={() => setTab("audio")}
				>
					<SlidersHorizontal size={14} />
					{t("reaction.mixer")}
				</button>
				<button
					id="recorder-hotkeys-tab"
					role="tab"
					aria-controls="recorder-panel"
					aria-selected={tab === "hotkeys"}
					onClick={() => setTab("hotkeys")}
				>
					<Keyboard size={14} />
					{t("reaction.hotkeys")}
				</button>
			</div>
			<div id="recorder-panel" role="tabpanel" aria-labelledby={`recorder-${tab}-tab`}>
				{tab === "audio" ? (
					<>
						<p className={styles.panelHint}>
							{t(recording ? "reaction.liveMixHint" : "reaction.mixHint")}
						</p>
						{(["microphone", "system"] as const).map((channel) => {
							const enabled = channel === "microphone" ? microphoneEnabled : systemEnabled;
							const disabled = locked || !available || !enabled;
							const label = t(channel === "microphone" ? "audio.microphone" : "audio.systemAudio");
							const Icon = channel === "microphone" ? Mic : Volume2;
							return (
								<div key={channel} className={styles.audioChannel}>
									<div className={styles.channelHeader}>
										<span>
											<Icon size={16} />
											{label}
										</span>
										<button
											disabled={disabled}
											aria-pressed={muted[channel]}
											aria-label={`${t(muted[channel] ? "reaction.unmute" : "reaction.mute")} ${label}`}
											onClick={() => onMute(channel)}
										>
											{t(muted[channel] ? "reaction.muted" : "reaction.mute")}
										</button>
									</div>
									<div className={styles.channelSlider}>
										<input
											type="range"
											aria-label={`${label} ${t("reaction.volume")}`}
											min={0}
											max={100}
											step={1}
											value={levels[channel]}
											style={{
												background: `linear-gradient(to right, ${muted[channel] ? "#665b76" : "#b899ff"} ${levels[channel]}%, #403747 ${levels[channel]}%)`,
											}}
											disabled={disabled}
											onChange={(event) => onLevel(channel, Number(event.target.value))}
										/>
										<output>{levels[channel]}%</output>
									</div>
									{!enabled && <p className={styles.panelHint}>{t("reaction.enableBefore")}</p>}
								</div>
							);
						})}
						{!available && <p className={styles.panelHint}>{t("reaction.unsupported")}</p>}
					</>
				) : (
					<>
						<p className={styles.panelHint}>{t("reaction.hotkeyHint")}</p>
						{RECORDING_ACTIONS.map((action) => {
							const binding = config[action];
							const modifier = binding.alt
								? binding.shift
									? "ctrlShiftAlt"
									: "ctrlAlt"
								: "ctrlShift";
							return (
								<label key={action} className={styles.shortcutRow}>
									<span>{t(`reaction.actions.${action}`)}</span>
									<div>
										<select
											disabled={recording || locked || saving}
											aria-label={`${t(`reaction.actions.${action}`)} ${t("reaction.modifiers")}`}
											value={modifier}
											onChange={(event) =>
												setConfig((previous) => ({
													...previous,
													[action]: {
														...binding,
														ctrl: true,
														shift: event.target.value !== "ctrlAlt",
														alt: event.target.value !== "ctrlShift",
													},
												}))
											}
										>
											<option value="ctrlShift">{isMac ? "⌘" : "Ctrl"} + Shift</option>
											<option value="ctrlAlt">{isMac ? "⌘" : "Ctrl"} + Alt</option>
											<option value="ctrlShiftAlt">{isMac ? "⌘" : "Ctrl"} + Shift + Alt</option>
										</select>
										<select
											disabled={recording || locked || saving}
											aria-label={`${t(`reaction.actions.${action}`)} ${t("reaction.key")}`}
											value={binding.key}
											onChange={(event) =>
												setConfig((previous) => ({
													...previous,
													[action]: { ...binding, key: event.target.value },
												}))
											}
										>
											{KEYS.map((key) => (
												<option key={key} value={key}>
													{key.toUpperCase()}
												</option>
											))}
										</select>
									</div>
								</label>
							);
						})}
						<button
							className={styles.saveShortcuts}
							disabled={recording || locked || saving}
							onClick={() => void save()}
						>
							{t("reaction.saveShortcuts")}
						</button>
					</>
				)}
			</div>
		</div>
	);
}
