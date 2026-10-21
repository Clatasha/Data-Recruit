// Voiceover dialog: record a narration take against the timeline, live from the
// microphone (MediaRecorder → webm/opus, written to the recordings dir by the
// main process), or import a file if the user already has one.
//
// Music and other imports do NOT come through here — they are a plain file
// import on the timeline toolbar (`tl.addAudio`). Recording is the only audio
// gesture that needs a dialog, because it has a live state to show.
//
// The dialog resolves the AUDIO ASSET and its duration, then reports back via
// `onComplete` — placing the track on the timeline (span, anchor, inspector
// selection) is the caller's job, exactly like the other add* flows.

import { Mic, RefreshCw, StopCircle, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toFileUrl } from "@/components/video-editor/projectPersistence";
import { useScopedT } from "@/contexts/I18nContext";
import type { AxcutAsset } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { probeAudioDuration } from "@/lib/ai-edition/timeline/duration";
import styles from "./EditorShellV4.module.css";

const RECORDER_MIME_PREFERENCES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function pickRecorderMimeType(): string {
	if (typeof MediaRecorder === "undefined") return "";
	for (const mime of RECORDER_MIME_PREFERENCES) {
		if (MediaRecorder.isTypeSupported(mime)) return mime;
	}
	return "";
}

/** Reuse an already-imported asset over importing the same file twice. */
function findExistingAsset(path: string): AxcutAsset | null {
	const doc = useProjectStore.getState().document;
	if (!doc) return null;
	return (
		doc.assets.find((a) => a.kind === "audio" && a.originalPath === path) ??
		doc.assets.find((a) => a.originalPath === path) ??
		null
	);
}

export function AddAudioLayerDialog({
	open,
	/** Timeline length in seconds — recording stops by itself when reached. */
	maxDurationSec,
	onClose,
	onComplete,
	onRecordingStart,
	onRecordingStop,
	onMuteProjectChange,
}: {
	open: boolean;
	maxDurationSec: number;
	onClose: () => void;
	onComplete: (assetId: string, durationSec: number) => void;
	onRecordingStart: () => void;
	onRecordingStop: () => void;
	onMuteProjectChange?: (muted: boolean) => void;
}) {
	const t = useScopedT("timeline");
	const tc = useScopedT("common");
	const [busy, setBusy] = useState(false);
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const [deviceId, setDeviceId] = useState("");
	const [muteProject, setMuteProject] = useState(true);
	const [cleanInput, setCleanInput] = useState(true);
	const [pendingTake, setPendingTake] = useState<{ blob: Blob; duration: number } | null>(null);
	const openRef = useRef(open);
	openRef.current = open;
	const requestRef = useRef(0);
	const refreshDevices = useCallback(async () => {
		try {
			const all = await navigator.mediaDevices?.enumerateDevices?.();
			if (all) setDevices(all.filter((d) => d.kind === "audioinput"));
		} catch {
			toast.error(t("audio.devicesFailed"));
		}
	}, [t]);
	useEffect(() => {
		if (open) void refreshDevices();
	}, [open, refreshDevices]);

	const [recording, setRecording] = useState(false);
	useEffect(() => {
		onMuteProjectChange?.(recording && muteProject);
		return () => onMuteProjectChange?.(false);
	}, [recording, muteProject, onMuteProjectChange]);
	const [elapsedSec, setElapsedSec] = useState(0);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const startedAtRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	// Set when the user cancels (closes the dialog mid-take) — the stop handler
	// then discards the blob instead of importing it as a layer.
	const discardRef = useRef(false);
	// Read by the Escape handler, which must not re-subscribe every time the
	// elapsed-time state ticks.
	const recordingRef = useRef(false);

	// Reset whenever the dialog opens again — a cancelled recording must not
	// leak its stream or timer into the next session.
	useEffect(() => {
		if (open) {
			setBusy(false);
			setRecording(false);
			recordingRef.current = false;
			setElapsedSec(0);
			setPendingTake(null);
		}
		return () => {
			requestRef.current++;
			if (timerRef.current) clearInterval(timerRef.current);
			timerRef.current = null;
			// Stop the RECORDER, not just the stream. Tearing the dialog down
			// mid-take (a project close, a shell unmount) used to drop the take on
			// the floor: `onstop` never fired, so the blob was never flushed and
			// `onRecordingStop` never ran — leaving the video element playing.
			// Discard rather than import: nobody is left to place the layer.
			const recorder = recorderRef.current;
			if (recorder && recorder.state !== "inactive") {
				discardRef.current = true;
				try {
					recorder.stop();
				} catch {
					// already torn down by the browser
				}
			}
			for (const track of streamRef.current?.getTracks() ?? []) track.stop();
			streamRef.current = null;
			recorderRef.current = null;
		};
	}, [open]);

	const stopRecording = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		const recorder = recorderRef.current;
		// `recorder.onstop` (registered at start) owns the save path.
		if (recorder && recorder.state !== "inactive") {
			recorder.stop();
		}
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
	}, []);

	const cancelRecording = useCallback(() => {
		discardRef.current = true;
		stopRecording();
		onRecordingStop();
		setRecording(false);
		recordingRef.current = false;
		setElapsedSec(0);
	}, [stopRecording, onRecordingStop]);

	const finishWithPath = useCallback(
		async (path: string, durationSec: number) => {
			setBusy(true);
			try {
				const existing = findExistingAsset(path);
				// `addAudioAsset` files it as audio explicitly: a recorded voiceover
				// lands as `.webm`, the same extension as a screen recording, so
				// extension guessing would import it as a video asset.
				const asset = existing ?? (await useProjectStore.getState().addAudioAsset(path));
				if (!asset) {
					toast.error(t("audio.importFailed"));
					return;
				}
				onComplete(asset.id, durationSec);
			} catch (err) {
				toast.error(t("audio.importFailed"), {
					description: err instanceof Error ? err.message : String(err),
				});
			} finally {
				setBusy(false);
			}
		},
		[onComplete, t],
	);

	const startRecording = useCallback(async () => {
		if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
			toast.error(t("audio.recordingUnavailable"));
			return;
		}
		if (busy || recordingRef.current) return;
		const request = ++requestRef.current;
		setBusy(true);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					deviceId: deviceId ? { exact: deviceId } : undefined,
					echoCancellation: cleanInput,
					noiseSuppression: cleanInput,
					autoGainControl: cleanInput,
				},
			});
			if (!openRef.current || request !== requestRef.current) {
				stream.getTracks().forEach((track) => track.stop());
				return;
			}
			streamRef.current = stream;
			void refreshDevices();
			setPendingTake(null);
			const mimeType = pickRecorderMimeType();
			const recorder = mimeType
				? new MediaRecorder(stream, { mimeType })
				: new MediaRecorder(stream);
			recorderRef.current = recorder;
			chunksRef.current = [];
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) chunksRef.current.push(event.data);
			};
			recorder.onstop = () => {
				const blob = new Blob(chunksRef.current, {
					type: recorder.mimeType || "audio/webm",
				});
				const duration = (performance.now() - startedAtRef.current) / 1000;
				const discarded = discardRef.current;
				discardRef.current = false;
				setRecording(false);
				recordingRef.current = false;
				setElapsedSec(0);
				onRecordingStop();
				if (discarded) return;
				setPendingTake({ blob, duration });
			};
			startedAtRef.current = performance.now();
			discardRef.current = false;
			recorder.start(250);
			setRecording(true);
			recordingRef.current = true;
			setElapsedSec(0);
			onRecordingStart();
			timerRef.current = setInterval(() => {
				setElapsedSec((performance.now() - startedAtRef.current) / 1000);
			}, 200);
		} catch {
			for (const track of streamRef.current?.getTracks() ?? []) track.stop();
			streamRef.current = null;
			toast.error(t("audio.micDenied"));
		} finally {
			if (request === requestRef.current) setBusy(false);
		}
	}, [busy, deviceId, cleanInput, refreshDevices, onRecordingStart, onRecordingStop, t]);
	const saveTake = async () => {
		if (!pendingTake || busy) return;
		const request = requestRef.current;
		setBusy(true);
		try {
			const saved = await window.electronAPI?.saveRecordedVoiceover?.(
				await pendingTake.blob.arrayBuffer(),
			);
			if (!openRef.current || request !== requestRef.current) return;
			if (!saved?.success || !saved.path) throw new Error(saved?.message || t("audio.saveFailed"));
			await finishWithPath(saved.path, pendingTake.duration);
		} catch (err) {
			toast.error(t("audio.saveFailed"), { description: String(err) });
		} finally {
			setBusy(false);
		}
	};

	// Stop by itself at the end of the timeline so a layer can never outlive
	// the video it was recorded over.
	useEffect(() => {
		if (!recording || !Number.isFinite(maxDurationSec) || maxDurationSec <= 0) return;
		if (elapsedSec >= maxDurationSec) {
			stopRecording();
			// `onRecordingStop` fires from the recorder's stop handler.
		}
	}, [recording, elapsedSec, maxDurationSec, stopRecording]);

	// Re-entrancy guard: the shell passes an inline `onComplete` and re-renders on
	// every playhead tick during playback, so a dialog left open while the video
	// plays re-creates this callback constantly. Without the guard a second click
	// (or any caller that fires on re-render) would stack `showOpenDialog` calls.
	const pickerOpenRef = useRef(false);

	const importFile = useCallback(async () => {
		if (pickerOpenRef.current) return;
		pickerOpenRef.current = true;
		try {
			const picker = await window.electronAPI?.openAudioFilePicker?.();
			if (!picker?.success || !picker.path) return;
			const url = toFileUrl(picker.path);
			// The probe needs the real duration to size the layer; when it fails the
			// caller falls back to the default span.
			const duration = (await probeAudioDuration(url)) ?? 0;
			await finishWithPath(picker.path, duration);
		} finally {
			pickerOpenRef.current = false;
		}
	}, [finishWithPath]);

	// Escape closes, the way it did when this was a modal — cancelling a take in
	// progress rather than saving a half-recorded one.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			if (recordingRef.current) cancelRecording();
			onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, cancelRecording, onClose]);

	if (!open) return null;

	return (
		<section className={styles.voiceoverPopup} role="dialog" aria-label={t("audio.addVoiceover")}>
			<header>
				<strong>{t("audio.addVoiceover")}</strong>
				<button
					type="button"
					aria-label={tc("actions.close")}
					disabled={busy}
					onClick={() => {
						if (recordingRef.current) cancelRecording();
						onClose();
					}}
				>
					<X size={17} />
				</button>
			</header>
			<label>
				{t("audio.device")}
				<div className={styles.voiceoverDevice}>
					<select
						aria-label={t("audio.device")}
						value={deviceId}
						disabled={recording || busy}
						onChange={(e) => setDeviceId(e.target.value)}
					>
						<option value="">{t("audio.defaultDevice")}</option>
						{devices
							.filter((d) => d.deviceId && d.deviceId !== "default")
							.map((d, i) => (
								<option key={d.deviceId} value={d.deviceId}>
									{d.label || `${t("audio.device")} ${i + 1}`}
								</option>
							))}
					</select>
					<button
						type="button"
						aria-label={t("audio.refreshDevices")}
						title={t("audio.refreshDevices")}
						disabled={recording || busy}
						onClick={() => void refreshDevices()}
					>
						<RefreshCw size={16} />
					</button>
				</div>
			</label>
			<label>
				{t("audio.input")}
				<select
					aria-label={t("audio.input")}
					disabled={recording || busy}
					value={cleanInput ? "clean" : "raw"}
					onChange={(e) => setCleanInput(e.target.value === "clean")}
				>
					<option value="clean">{t("audio.cleanInput")}</option>
					<option value="raw">{t("audio.rawInput")}</option>
				</select>
			</label>
			<label className={styles.voiceoverCheck}>
				<input
					type="checkbox"
					checked={muteProject}
					disabled={busy}
					onChange={(e) => setMuteProject(e.target.checked)}
				/>
				{t("audio.muteProject")}
			</label>
			<div className={styles.voiceoverRecordArea}>
				<button
					type="button"
					className={styles.voiceoverRecordButton}
					disabled={busy}
					aria-label={recording ? t("audio.stop") : t("audio.record")}
					onClick={() => (recording ? stopRecording() : void startRecording())}
				>
					{recording ? <StopCircle size={32} /> : <Mic size={30} />}
					<span>{recording ? t("audio.stop") : t("audio.record")}</span>
				</button>
				<output aria-live={recording ? "off" : "polite"}>
					{t("audio.recordTime")}{" "}
					{Math.floor((pendingTake?.duration ?? elapsedSec) / 60)
						.toString()
						.padStart(2, "0")}
					:
					{Math.floor((pendingTake?.duration ?? elapsedSec) % 60)
						.toString()
						.padStart(2, "0")}
				</output>
				<p>
					{recording
						? t("audio.recordingHint")
						: pendingTake
							? t("audio.takeReady")
							: t("audio.subtitle")}
				</p>
			</div>
			<footer>
				<button
					type="button"
					disabled={busy || recording}
					className={styles.voiceoverBarBtn}
					onClick={() => void importFile()}
				>
					<Upload size={15} />
					{t("audio.importFile")}
				</button>
				<button
					type="button"
					disabled={busy || recording || !pendingTake}
					className={styles.voiceoverConfirm}
					onClick={() => void saveTake()}
				>
					{t("audio.addTake")}
				</button>
			</footer>
		</section>
	);
}
