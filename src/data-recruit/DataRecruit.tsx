import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import logoMark from "@/assets/data-recruit-mark.svg";
import { attachClipAudio } from "@/lib/ai-edition/document/editorTracks";
import { createId } from "@/lib/ai-edition/document/ids";
import { withClipsChanged } from "@/lib/ai-edition/document/timeline";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { type Bookend, loadBookend, loadImage, pauseBookends, serializeBookend } from "./bookends";
import { encodeScroll } from "./export";
import { DEFAULT_EXPORT, type ExportSettings, exportGeometry } from "./exportSettings";
import { MusicTimeline } from "./MusicTimeline";
import {
	badgeNumber,
	type CardTemplate,
	DEFAULT_BADGE,
	FACTS_TEXT,
	geometry,
	imageNumber,
	parseCards,
	SAMPLE_TEXT,
	type ScrollSettings,
	TEMPLATES,
	validateCards,
} from "./model";
import { loadMusic, type MusicClip, musicSchema, serializeMusic } from "./music";
import { MusicPreview } from "./musicPreview";
import { useProjectHistory } from "./projectHistory";
import { recovery } from "./recovery";
import { type CardImage, renderCard } from "./render";
import { drawSequence } from "./sequence";
import {
	INTRO_TRANSITIONS,
	OUTRO_TRANSITIONS,
	outroTransition,
	sequenceFrame,
	sequenceTiming,
	TRANSITIONS,
	type Transition,
} from "./transitions";
import { usePreviewClock } from "./usePreviewClock";
import "./data-recruit.css";

const rowSchema = z.object({
	key: z.string().min(1),
	label: z.string().min(1),
	color: z.string().regex(/^#[0-9a-f]{6}$/i),
	valueColor: z.string().regex(/^#[0-9a-f]{6}$/i),
});
const badgeSchema = z.object({
	enabled: z.boolean(),
	direction: z.enum(["up", "down"]),
	start: z.number().int().min(-9999).max(9999).optional(),
	size: z.number().min(0.08).max(0.3),
	color: z.string().regex(/^#[0-9a-f]{6}$/i),
	textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
});
const templateSchema = z.object({
	badge: badgeSchema.optional(),
	id: z.string(),
	name: z.string().min(1),
	titleColor: z.string().regex(/^#[0-9a-f]{6}$/i),
	textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
	font: z.enum(["Arial", "Verdana", "Georgia", "Impact"]).optional(),
	textScale: z.number().min(0.5).max(1.5).optional(),
	outline: z.number().min(0).max(0.15).optional(),
	outlineColor: z
		.string()
		.regex(/^#[0-9a-f]{6}$/i)
		.optional(),
	spacing: z.number().min(0.005).max(0.06).optional(),
	imageHeight: z.number().min(0.3).max(0.65).optional(),
	rows: z.array(rowSchema).min(1).max(6),
});
const imageSchema = z.object({
	id: z.number().int().positive(),
	name: z.string(),
	url: z.string().startsWith("data:image/"),
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
});
const bookendSchema = z
	.object({
		name: z.string(),
		url: z
			.string()
			.regex(
				/^(?:data:(?:image|video)\/|data-recruit-media:[a-f0-9-]{36}\.(?:mp4|webm|mov|m4v|png|jpg|jpeg|webp)$)/i,
			),
		transition: z.enum(TRANSITIONS).default("none"),
		transitionSeconds: z.number().min(0.1).max(3).default(0.75),
		kind: z.enum(["image", "video"]).default("image"),
		start: z.number().min(0).max(86400).default(0),
		volume: z.number().min(0).max(1).default(1),
		muted: z.boolean().default(false),
		duration: z.number().min(0.1).max(600),
	})
	.nullable();
const recipeSchema = z.object({
	version: z.literal(1),
	music: z.array(musicSchema).max(100).default([]),
	order: z.array(z.number().int().positive()).default([]),
	exportOptions: z
		.object({
			resolution: z.union([z.literal(720), z.literal(1080), z.literal(1440)]),
			fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
			quality: z.enum(["standard", "high"]),
		})
		.default(DEFAULT_EXPORT),
	text: z.string(),
	template: templateSchema,
	settings: z.object({
		format: z.enum(["landscape", "shorts"]),
		direction: z.enum(["left", "right"]),
		secondsPerCard: z.number().min(1).max(20),
		fit: z.enum(["fill", "fit"]),
	}),
	images: z.array(imageSchema).max(100),
	intro: bookendSchema,
	outro: bookendSchema,
});
const readUrl = (file: File): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
		reader.readAsDataURL(file);
	});
function download(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
const clock = (time: number) =>
	`${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

export default function DataRecruit({
	onOpenEditor,
	onPrepareEditor,
}: {
	onOpenEditor?: (poster?: string) => void;
	onPrepareEditor?: () => Promise<unknown>;
}) {
	const emptyProject = () => ({
		text: SAMPLE_TEXT,
		template: structuredClone(TEMPLATES[0]) as CardTemplate,
		images: [] as CardImage[],
		settings: {
			format: "landscape",
			direction: "left",
			secondsPerCard: 4,
			fit: "fill",
		} as ScrollSettings,
		intro: null as Bookend | null,
		outro: null as Bookend | null,
		order: [] as number[],
		music: [] as MusicClip[],
		exportOptions: { ...DEFAULT_EXPORT },
	});
	const history = useProjectHistory(emptyProject());
	const currentProject = useRef(history.present);
	currentProject.current = history.present;
	const [savingProject, setSavingProject] = useState(false);
	const savePending = useRef(false);
	const { text, template, images, settings, intro, outro, order, exportOptions, music } =
		history.present;
	const setter =
		<K extends keyof typeof history.present>(key: K) =>
		(value: SetStateAction<(typeof history.present)[K]>) =>
			history.update(key, value);
	const setText = setter("text"),
		setMusic = setter("music"),
		setTemplate = setter("template"),
		setImages = setter("images"),
		setSettings = setter("settings"),
		setIntro = setter("intro"),
		setOutro = setter("outro"),
		setOrder = setter("order"),
		setExportOptions = setter("exportOptions");
	const [audioLoading, setAudioLoading] = useState(false);
	const audioImport = useRef<AbortController | null>(null);
	const [previewVolume, setPreviewVolume] = useState(() => {
		try {
			const saved = localStorage.getItem("data-recruit-preview-volume");
			const value = saved === null ? 0.5 : Number(saved);
			return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
		} catch {
			return 0.5;
		}
	});
	const musicPreview = useRef<MusicPreview | null>(null);
	useEffect(
		() => () => {
			musicPreview.current?.dispose();
			audioImport.current?.abort();
		},
		[],
	);
	const [newProjectPrompt, setNewProjectPrompt] = useState(false);
	const projectGeneration = useRef(0);
	const [draft, setDraft] = useState<string | null>(null);
	const [recoveryReady, setRecoveryReady] = useState(false),
		[recoveryStatus, setRecoveryStatus] = useState("");
	const [savedState, setSavedState] = useState(history.present);
	const dirty = savedState !== history.present;
	const dragged = useRef<number | null>(null);
	useEffect(() => {
		void recovery()
			.then(setDraft)
			.catch(() =>
				setRecoveryStatus("Recovery is unavailable in this session. Save your project file."),
			)
			.finally(() => setRecoveryReady(true));
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Serialize only project edits; transport state does not change the recipe.
	useEffect(() => {
		if (!recoveryReady || draft || !dirty) return;
		setRecoveryStatus("Saving recovery copy…");
		const timer = setTimeout(() => {
			void recovery(JSON.stringify(recipe()))
				.then(() => setRecoveryStatus("Recovery copy saved"))
				.catch(() => setRecoveryStatus("Recovery could not be saved. Save your project file."));
		}, 1000);
		return () => clearTimeout(timer);
	}, [history.present, recoveryReady, draft, dirty]);
	useEffect(() => {
		void window.electronAPI?.dataRecruitSetDirty?.(dirty);
	}, [dirty]);
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (dirty && !window.electronAPI?.dataRecruitSetDirty) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);
	const [custom, setCustom] = useState<CardTemplate[]>(() => {
		try {
			return z
				.array(templateSchema)
				.parse(JSON.parse(localStorage.getItem("data-recruit-templates") || "[]"));
		} catch {
			return [];
		}
	});
	const templateChoices = [...TEMPLATES, ...custom];
	if (!templateChoices.some((item) => item.id === template.id)) templateChoices.push(template);
	const [selected, setSelected] = useState<number | null>(null);
	const [time, setTime] = useState(0),
		[playing, setPlaying] = useState(false);
	const [built, setBuilt] = useState(false),
		[busy, setBusy] = useState(false),
		[progress, setProgress] = useState(0);
	const [message, setMessage] = useState(
		"Choose your images to start. The sample data shows the text format.",
	);
	const canvasRef = useRef<HTMLCanvasElement>(null),
		abortRef = useRef<AbortController | null>(null);
	const parsed = useMemo(() => {
		try {
			const cards = parseCards(text);
			return {
				cards: [...cards].sort((a, b) => {
					const ai = order.indexOf(a.id),
						bi = order.indexOf(b.id);
					return (
						(ai < 0 ? order.length + cards.indexOf(a) : ai) -
						(bi < 0 ? order.length + cards.indexOf(b) : bi)
					);
				}),
				error: "",
			};
		} catch (error) {
			return { cards: [], error: String(error instanceof Error ? error.message : error) };
		}
	}, [text, order]);
	// Undoing a duplicate can remove the selected ID while restoring the original card.
	// Keep the inspector on an existing card instead of hiding its image controls.
	useEffect(() => {
		if (selected === null || parsed.error) return;
		const exists =
			parsed.cards.some((card) => card.id === selected) ||
			images.some((image) => image.id === selected);
		if (!exists) setSelected(parsed.cards[0]?.id ?? images[0]?.id ?? null);
	}, [selected, parsed, images]);
	const problems = useMemo(
		() =>
			parsed.error
				? [parsed.error]
				: validateCards(
						parsed.cards,
						template,
						images.map((image) => image.id),
					),
		[parsed, template, images],
	);
	const rendered = useMemo(
		() =>
			parsed.cards.map((card, index) =>
				renderCard(
					card,
					images.find((image) => image.id === card.id),
					template,
					settings,
					template.badge ? badgeNumber(template.badge, index, parsed.cards.length) : undefined,
				),
			),
		[parsed.cards, images, template, settings],
	);
	const timing = sequenceTiming(rendered.length, settings, intro, outro);
	const total = timing.total;
	const dims = geometry(settings.format);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Source edits update the timeline immediately and reset playback.
	useEffect(() => {
		setPlaying(false);
		setTime(0);
	}, [text, images, template, settings, intro, outro, order]);
	const paint = useCallback(
		(at: number) => {
			const ctx = canvasRef.current?.getContext("2d");
			if (!ctx) return;
			const frame = sequenceFrame(at, rendered.length, settings, intro, outro);
			for (const item of [intro, outro]) {
				if (item?.kind !== "video") continue;
				const isIntro = item === intro;
				const visible = isIntro ? frame.introVisible : frame.outroVisible;
				const localTime = isIntro ? frame.introTime : frame.outroTime;
				const advancing = isIntro
					? at < item.duration
					: at >= frame.outroHold && localTime < item.duration;
				if (visible) {
					const target =
						(item.start ?? 0) +
						Math.max(0, Math.min(item.duration - 1 / exportOptions.fps, localTime));
					if (
						!item.media.seeking &&
						Math.abs(item.media.currentTime - target) > (playing && advancing ? 0.2 : 0.015)
					)
						item.media.currentTime = target;
					item.media.muted = item.muted || !advancing;
					item.media.volume = (item.volume ?? 1) * previewVolume;
					if (playing && !busy && advancing && item.media.paused)
						void item.media.play().catch(() => {
							setPlaying(false);
							setMessage("Video playback could not start. Press Play to retry.");
						});
					else if (!playing || busy || !advancing) item.media.pause();
				} else item.media.pause();
			}

			musicPreview.current ??= new MusicPreview();
			musicPreview.current.sync(music, at, playing && !busy, previewVolume);
			drawSequence(ctx, rendered, settings, at, intro, outro);
		},
		[rendered, settings, intro, outro, playing, busy, exportOptions.fps, music, previewVolume],
	);
	const livePosition = usePreviewClock({
		position: time,
		playing,
		duration: total,
		paint,
		onPosition: setTime,
		onEnded: () => setPlaying(false),
	});
	useEffect(() => {
		const repaint = () => paint(livePosition.current);
		for (const item of [intro, outro])
			if (item?.kind === "video") item.media.addEventListener("seeked", repaint);
		return () => {
			for (const item of [intro, outro])
				if (item?.kind === "video") item.media.removeEventListener("seeked", repaint);
		};
	}, [intro, outro, paint, livePosition]);
	useEffect(
		() => () => {
			pauseBookends(intro, outro);
		},
		[intro, outro],
	);
	useEffect(() => () => abortRef.current?.abort(), []);
	const fail = (error: unknown) =>
		setMessage(error instanceof Error ? error.message : String(error));
	async function importImages(files: File[]) {
		const generation = projectGeneration.current;
		if (!files.length) return;
		try {
			if (files.length > 100)
				throw new Error("Select up to 100 images at a time. You can add more in another batch.");
			const loaded: CardImage[] = [];
			for (const file of files) {
				const id = imageNumber(file.name);
				if (id === null)
					throw new Error(
						`Rename ${file.name} to start with its entry number, for example 1.jpg or 1 - Movie.jpg.`,
					);
				if (loaded.some((image) => image.id === id))
					throw new Error(`Two images use number ${id}. Give each image a unique number.`);
				const url = await readUrl(file);
				loaded.push({ id, name: file.name, url, x: 0.5, y: 0.5, image: await loadImage(url) });
			}
			if (generation !== projectGeneration.current) return;
			history.checkpoint();
			setImages((existing) =>
				[
					...existing.filter((image) => !loaded.some((added) => added.id === image.id)),
					...loaded,
				].sort((a, b) => a.id - b.id),
			);
			setSelected(loaded[0]?.id ?? null);
			setMessage(`${loaded.length} numbered images added or replaced. Other cards were kept.`);
		} catch (error) {
			fail(error);
		}
	}
	async function replaceImage(file: File | undefined, id: number) {
		const generation = projectGeneration.current;
		if (!file) return;
		try {
			const url = await readUrl(file),
				image = await loadImage(url);
			if (generation !== projectGeneration.current) return;
			history.checkpoint();
			setImages((existing) =>
				[
					...existing.filter((value) => value.id !== id),
					{ id, name: file.name, url, image, x: 0.5, y: 0.5 },
				].sort((a, b) => a.id - b.id),
			);
			setMessage(`Image #${id} replaced. The other cards were kept.`);
		} catch (error) {
			fail(error);
		}
	}
	async function addBookend(file: File | undefined, kind: "intro" | "outro") {
		const generation = projectGeneration.current;
		if (!file) return;
		try {
			const mediaKind =
				file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name)
					? "video"
					: "image";
			const value = await loadBookend(file.name, await readUrl(file), mediaKind);
			if (value.duration > 600) value.duration = 600;
			if (generation !== projectGeneration.current) return;
			history.checkpoint();
			(kind === "intro" ? setIntro : setOutro)(value);
			setMessage(
				`${kind === "intro" ? "Intro" : "Outro"} ${mediaKind} added. ${mediaKind === "video" ? "Original audio is included unless muted." : ""}`,
			);
		} catch (error) {
			fail(error);
		}
	}
	async function pickBookend(kind: "intro" | "outro") {
		const generation = projectGeneration.current;
		try {
			const selected = await window.electronAPI?.dataRecruitPickBookend?.();
			if (!selected || generation !== projectGeneration.current) return;
			setMessage(`Loading ${kind}…`);
			const value = await loadBookend(selected.name, selected.url, selected.kind);
			if (value.duration > 600) value.duration = 600;
			if (generation !== projectGeneration.current) return;
			history.checkpoint();
			(kind === "intro" ? setIntro : setOutro)(value);
			setMessage(
				`${kind === "intro" ? "Intro" : "Outro"} ${selected.kind} added. ${selected.kind === "video" ? "Original audio is included unless muted." : ""}`,
			);
		} catch (error) {
			if (generation === projectGeneration.current) fail(error);
		}
	}
	async function importMusic(sources: { name: string; url: string }[], at: number) {
		if (audioImport.current || !sources.length) return;
		if (music.length + sources.length > 100) {
			setMessage("Use up to 100 audio clips per project.");
			return;
		}
		const generation = projectGeneration.current;
		const controller = new AbortController();
		audioImport.current = controller;
		setAudioLoading(true);
		setPlaying(false);
		try {
			const added: MusicClip[] = [];
			let cursor = Math.max(0, Math.min(total, at));
			for (const source of sources) {
				setMessage(`Loading audio ${added.length + 1}/${sources.length}: ${source.name}…`);
				const clip = await loadMusic(source.name, source.url, controller.signal);
				controller.signal.throwIfAborted();
				clip.at = Math.min(cursor, 1199.9);
				clip.duration = Math.min(clip.duration, 1200 - clip.at);
				added.push(clip);
				cursor += clip.duration;
			}
			if (generation !== projectGeneration.current) return;
			history.checkpoint();
			setMusic((existing) => [...existing, ...added]);
			setMessage(
				`${added.length} audio clips added. Select a waveform to edit volume, trim and fades.`,
			);
		} catch (error) {
			if (generation === projectGeneration.current) fail(error);
		} finally {
			if (audioImport.current === controller) {
				audioImport.current = null;
				setAudioLoading(false);
			}
		}
	}
	async function addMusicFiles(files: File[], at: number) {
		const generation = projectGeneration.current;
		try {
			if (files.length + music.length > 100)
				throw new Error("Use up to 100 audio clips per project.");
			const sources = [];
			for (const file of files) {
				if (
					!file.type.startsWith("audio/") &&
					!/\.(mp3|wav|m4a|aac|ogg|flac|opus|webm|mp4)$/i.test(file.name)
				)
					throw new Error(`Choose an audio file: ${file.name}`);
				sources.push({
					name: file.name,
					url: (await readUrl(file)).replace(/^data:[^;,]*/, "data:audio/octet-stream"),
				});
			}
			if (generation === projectGeneration.current) await importMusic(sources, at);
		} catch (error) {
			if (generation === projectGeneration.current) fail(error);
		}
	}
	async function pickMusic(at: number) {
		const generation = projectGeneration.current;
		try {
			const sources = await window.electronAPI?.dataRecruitPickMusic?.();
			if (sources && generation === projectGeneration.current) await importMusic(sources, at);
		} catch (error) {
			if (generation === projectGeneration.current) fail(error);
		}
	}
	function newProject() {
		projectGeneration.current++;
		audioImport.current?.abort();
		musicPreview.current?.stop();
		pauseBookends(intro, outro);
		const next = history.reset(emptyProject());
		setSavedState(next);
		setDraft(null);
		setSelected(null);
		setPlaying(false);
		setTime(0);
		setBuilt(false);
		setProgress(0);
		setNewProjectPrompt(false);
		setMessage("New project ready. Choose your images and import your numbered text.");
		void recovery(null)
			.then(() => setRecoveryStatus(""))
			.catch(() => setRecoveryStatus("Recovery could not be cleared."));
	}
	function recipe() {
		return {
			version: 1,
			music: music.map(serializeMusic),
			order,
			exportOptions,
			text,
			template,
			settings,
			images: images.map(({ image: _image, ...value }) => value),
			intro: serializeBookend(intro),
			outro: serializeBookend(outro),
		};
	}
	async function saveProject() {
		if (savePending.current) return false;
		savePending.current = true;
		setSavingProject(true);
		const snapshot = history.present;
		const generation = projectGeneration.current;
		try {
			const content = JSON.stringify(recipe());
			const desktop = window.electronAPI?.dataRecruitSaveProject;
			if (desktop) {
				const path = await desktop(content);
				if (!path) {
					setMessage("Project save cancelled. Your changes are still here.");
					return false;
				}
			} else {
				download(new Blob([content], { type: "application/json" }), "Data-Recruit.project.json");
			}
			if (generation !== projectGeneration.current) return false;
			setSavedState(snapshot);
			setMessage(desktop ? "Project saved." : "Project downloaded.");
			void recovery(content)
				.then(() => setRecoveryStatus("Recovery copy saved"))
				.catch(() => setRecoveryStatus("Recovery could not be saved. Keep your project file."));
			return currentProject.current === snapshot;
		} catch (error) {
			fail(error);
			return false;
		} finally {
			savePending.current = false;
			setSavingProject(false);
		}
	}

	async function openRecipe(file: File | undefined, source?: string) {
		if (!file && !source) return;
		const generation = ++projectGeneration.current;
		audioImport.current?.abort();
		setPlaying(false);
		try {
			const value = recipeSchema.parse(JSON.parse(source ?? (await file!.text())));
			if (new Set(value.images.map((image) => image.id)).size !== value.images.length)
				throw new Error("Project contains duplicate image numbers.");
			const loaded = await Promise.all(
				value.images.map(async (image) => ({ ...image, image: await loadImage(image.url) })),
			);
			const restoreBookend = async (item: typeof value.intro) =>
				item
					? loadBookend(
							item.name,
							item.url,
							item.kind,
							item.duration,
							item.muted,
							item.start,
							item.volume,
						).then((media) => ({
							...media,
							transition: item.transition,
							transitionSeconds: item.transitionSeconds,
						}))
					: null;
			const restoredMusic: MusicClip[] = [];
			const sources = new Map<string, MusicClip>();
			for (const clip of value.music) {
				let source = sources.get(clip.url);
				if (!source) {
					source = await loadMusic(clip.name, clip.url);
					sources.set(clip.url, source);
				}
				if (
					clip.start >= Math.min(source.buffer.duration, clip.end ?? source.buffer.duration) ||
					(!clip.loop &&
						clip.start + clip.duration >
							Math.min(source.buffer.duration, clip.end ?? source.buffer.duration) + 0.05) ||
					clip.at + clip.duration > 1200.05
				)
					throw new Error(`Invalid audio trim: ${clip.name}`);
				restoredMusic.push({ ...source, ...clip });
			}
			if (new Set(restoredMusic.map((clip) => clip.id)).size !== restoredMusic.length)
				throw new Error("Project contains duplicate audio clip IDs.");
			const [first, last] = await Promise.all([
				restoreBookend(value.intro),
				restoreBookend(value.outro),
			]);
			if (generation !== projectGeneration.current) return;
			const next = history.replace({
				...history.present,
				order: value.order,
				music: restoredMusic,
				exportOptions: value.exportOptions,
				text: value.text,
				template: value.template,
				settings: value.settings,
				images: loaded,
				intro: first,
				outro: last,
			});
			if (!source) setSavedState(next);
			setSelected(loaded[0]?.id ?? null);
			setDraft(null);
			setMessage("Project opened. Click Build Timeline when ready.");
		} catch (error) {
			fail(error);
		}
	}
	function ensureReady() {
		if (problems.length) {
			setMessage(problems.slice(0, 5).join(" "));
			return false;
		}
		if (total > 1200) {
			setMessage("This project exceeds 20 minutes. Increase the speed or use fewer cards.");
			return false;
		}
		setBuilt(true);
		return true;
	}
	function build() {
		if (!ensureReady()) return;
		setTime(0);
		setPlaying(true);
		setMessage("Timeline built. Preview the scroll, export MP4, or continue in the editor.");
	}
	async function exportVideo(editor = false) {
		if (busy || audioLoading || !ensureReady()) return;
		setBusy(true);
		setMessage("Preparing MP4 video and audio…");
		setPlaying(false);
		setProgress(0);
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const [{ bytes, hasAudio, poster }] = await Promise.all([
				encodeScroll(
					rendered,
					settings,
					intro,
					outro,
					setProgress,
					controller.signal,
					exportOptions,
					music,
				),
				editor ? onPrepareEditor?.() : Promise.resolve(),
			]);
			if (controller.signal.aborted) throw new Error("Build cancelled.");
			if (editor) {
				if (!window.electronAPI?.dataRecruitSaveVideo)
					throw new Error(
						"Continue in Editor is available in the desktop app. You can export MP4 here.",
					);
				const path = await window.electronAPI.dataRecruitSaveVideo(bytes, JSON.stringify(recipe()));
				const store = () => useProjectStore.getState();
				await store().createProject(`Data Recruit · ${template.name}`);
				const asset = await store().addAsset(path, "Scrolling cards");
				const audio = hasAudio ? await store().addAudioAsset(path, "Builder audio mix") : null;
				if (hasAudio && !audio)
					throw new Error("Could not add the intro/outro audio to the editor.");
				const doc = store().document;
				if (!asset || !doc) throw new Error("Could not add the generated video to the editor.");
				let next = withClipsChanged(doc, [
					{
						id: createId("clip"),
						assetId: asset.id,
						sourceStartSec: 0,
						sourceEndSec: total,
						timelineStartSec: 0,
						timelineEndSec: total,
						wordRefs: [],
						origin: "user",
						reason: "Built by Data Recruit",
						embeddedAudioMuted: false,
					},
				]);
				if (audio) next = attachClipAudio(next, next.timeline.clips[0].id, audio.id);
				next.legacyEditor = {
					...next.legacyEditor,
					aspectRatio: settings.format === "shorts" ? "9:16" : "16:9",
					padding: 0,
					borderRadius: 0,
					shadowIntensity: 0,
				};
				if (!(await store().saveDocument(next, { history: false })))
					throw new Error("Could not save the editor timeline.");
				onOpenEditor?.(poster);
			} else {
				if (window.electronAPI?.dataRecruitExportVideo) {
					const saved = await window.electronAPI.dataRecruitExportVideo(bytes);
					setMessage(
						saved
							? `MP4 ready. Saved to ${saved}`
							: "Export save cancelled. Your project is still here.",
					);
				} else {
					download(new Blob([bytes], { type: "video/mp4" }), "Data-Recruit.mp4");
					setMessage("MP4 ready. Save your project too if you want to change the cards later.");
				}
			}
		} catch (error) {
			controller.abort();
			fail(error);
		} finally {
			setBusy(false);
			abortRef.current = null;
		}
	}
	const chosen = images.find((image) => image.id === selected);
	const selectedCard = parsed.cards.find((card) => card.id === selected);
	function updateField(key: string, value: string) {
		const cards = parsed.cards.map((card) =>
			card.id === selected ? { ...card, fields: { ...card.fields, [key]: value } } : card,
		);
		setText(
			cards
				.map(
					(card) =>
						`${card.id}\n${Object.entries(card.fields)
							.map(([label, content]) => `${label}: ${content}`)
							.join("\n")}`,
				)
				.join("\n\n"),
		);
	}
	function cardsText(cards: typeof parsed.cards) {
		return cards
			.map(
				(card) =>
					`${card.id}\n${Object.entries(card.fields)
						.map(([key, value]) => `${key}: ${value}`)
						.join("\n")}`,
			)
			.join("\n\n");
	}
	function moveCard(from: number | null, target: number | undefined) {
		if (from === null || target === undefined || from === target) return;
		history.checkpoint();
		const ids = parsed.cards.map((c) => c.id).filter((id) => id !== from);
		ids.splice(ids.indexOf(target), 0, from);
		setOrder(ids);
	}
	function duplicateCard() {
		history.checkpoint();
		if (!selectedCard || parsed.cards.length >= 100) return;
		const id = Math.max(0, ...parsed.cards.map((c) => c.id), ...images.map((i) => i.id)) + 1;
		const cards = [...parsed.cards];
		cards.splice(cards.indexOf(selectedCard) + 1, 0, { id, fields: { ...selectedCard.fields } });
		setText(cardsText(cards));
		setOrder(cards.map((c) => c.id));
		if (chosen) setImages([...images, { ...chosen, id }]);
		setSelected(id);
	}
	return (
		<div className="dr-app">
			<header className="dr-header">
				<div className="dr-brand">
					<img className="dr-logo" src={logoMark} alt="Data Recruit" />
					<div>
						Data Recruit<small>SCROLLING VIDEO STUDIO</small>
					</div>
				</div>
				<nav>
					<button
						type="button"
						disabled={busy || audioLoading}
						onClick={() => (dirty ? setNewProjectPrompt(true) : newProject())}
					>
						New project
					</button>
					<button type="button" disabled={!history.canUndo || busy} onClick={history.undo}>
						Undo
					</button>
					<button type="button" disabled={!history.canRedo || busy} onClick={history.redo}>
						Redo
					</button>
					<label className="dr-button">
						Open project
						<input
							type="file"
							accept=".json"
							hidden
							onChange={(event) => {
								void openRecipe(event.target.files?.[0]);
								event.target.value = "";
							}}
						/>
					</label>
					<button type="button" disabled={savingProject} onClick={() => void saveProject()}>
						{savingProject ? "Saving project…" : "Save project"}
					</button>
					<button
						className="dr-primary"
						type="button"
						disabled={busy || audioLoading}
						onClick={() => void exportVideo()}
					>
						Export MP4 ↗
					</button>
				</nav>
			</header>
			{newProjectPrompt && (
				<div
					className="dr-new-project"
					role="dialog"
					aria-modal="true"
					aria-label="Start a new project?"
				>
					<div>
						<h2>Start a new project?</h2>
						<p>Save your current project or discard its unsaved changes.</p>
						<button type="button" onClick={() => setNewProjectPrompt(false)}>
							Cancel
						</button>{" "}
						<button type="button" onClick={newProject}>
							Discard and start new
						</button>{" "}
						<button
							type="button"
							className="dr-primary"
							disabled={savingProject}
							onClick={() => {
								void saveProject().then((saved) => {
									if (saved) newProject();
								});
							}}
						>
							Save and start new
						</button>
					</div>
				</div>
			)}

			{draft && (
				<div className="dr-recovery">
					A recovery copy is available.{" "}
					<button
						type="button"
						onClick={() => {
							void openRecipe(undefined, draft);
						}}
					>
						Restore project
					</button>{" "}
					<button
						type="button"
						onClick={() => {
							setDraft(null);
							void recovery(null).catch(fail);
						}}
					>
						Discard recovery
					</button>
				</div>
			)}
			<div className="dr-workspace">
				<aside className="dr-sidebar">
					<div className="dr-section-title">
						CREATE YOUR VIDEO <span>01—03</span>
					</div>
					<section>
						<h2>
							<b>01</b> Images <small>{images.length} added</small>
						</h2>
						<label className="dr-drop">
							{images.length ? "＋ Add more images" : "＋ Select numbered images"}
							<small>1.jpg, 2.jpg, 3.jpg · PNG / JPG / WebP</small>
							<small>Add batches anytime. Matching numbers replace existing images.</small>
							<input
								type="file"
								accept="image/png,image/jpeg,image/webp"
								multiple
								hidden
								onChange={(event) => {
									void importImages(Array.from(event.target.files || []));
									event.target.value = "";
								}}
							/>
						</label>
						<div
							className={`dr-images${images.length > 12 ? " dr-images-scroll" : ""}`}
							role="region"
							aria-label="Added images"
							tabIndex={images.length > 12 ? 0 : undefined}
						>
							{[...images]
								.sort(
									(a, b) =>
										parsed.cards.findIndex((c) => c.id === a.id) -
										parsed.cards.findIndex((c) => c.id === b.id),
								)
								.map((image) => (
									<button
										type="button"
										key={image.id}
										className={selected === image.id ? "selected" : ""}
										title={image.name}
										draggable
										onDragStart={() => {
											dragged.current = image.id;
										}}
										onDragOver={(event) => event.preventDefault()}
										onDrop={(event) => {
											event.preventDefault();
											moveCard(dragged.current, image.id);
											dragged.current = null;
										}}
										onClick={() => setSelected(image.id)}
									>
										<img src={image.url} alt={image.name} />
										<span>{image.id}</span>
									</button>
								))}
						</div>
					</section>
					<section>
						<h2>
							<b>02</b> Template & format
						</h2>
						<select
							aria-label="Template"
							value={template.id}
							onChange={(event) => {
								const next = templateChoices.find((item) => item.id === event.target.value);
								if (next) setTemplate(structuredClone(next));
							}}
						>
							{templateChoices.map((item) => (
								<option key={item.id} value={item.id}>
									{item.name}
								</option>
							))}
						</select>
						<div className="dr-segment">
							<button
								type="button"
								className={settings.format === "landscape" ? "active" : ""}
								onClick={() => setSettings({ ...settings, format: "landscape" })}
							>
								▭ 16:9 Landscape
							</button>
							<button
								type="button"
								className={settings.format === "shorts" ? "active" : ""}
								onClick={() => setSettings({ ...settings, format: "shorts" })}
							>
								▯ 9:16 Shorts
							</button>
						</div>
						<details>
							<summary>Card number badges</summary>
							<label>
								<input
									type="checkbox"
									checked={template.badge?.enabled ?? false}
									onChange={(event) =>
										setTemplate({
											...template,
											badge: { ...DEFAULT_BADGE, ...template.badge, enabled: event.target.checked },
										})
									}
								/>{" "}
								Show numbered circles
							</label>
							{template.badge?.enabled && (
								<>
									<label>
										Number order
										<select
											aria-label="Badge number order"
											value={template.badge.direction}
											onChange={(event) =>
												setTemplate({
													...template,
													badge: {
														...template.badge!,
														direction: event.target.value as "up" | "down",
														start: undefined,
													},
												})
											}
										>
											<option value="up">Count up · 1, 2, 3…</option>
											<option value="down">
												Count down · {parsed.cards.length}, {parsed.cards.length - 1}, …
											</option>
										</select>
									</label>
									<label>
										Starting number
										<input
											aria-label="Badge starting number"
											type="number"
											min="-9999"
											max="9999"
											placeholder="Auto"
											value={template.badge.start ?? ""}
											onChange={(event) =>
												setTemplate({
													...template,
													badge: {
														...template.badge!,
														start:
															event.target.value === ""
																? undefined
																: Math.max(
																		-9999,
																		Math.min(9999, Math.trunc(Number(event.target.value))),
																	),
													},
												})
											}
										/>
									</label>
									<label>
										Circle size
										<input
											type="range"
											min="0.08"
											max="0.3"
											step="0.01"
											value={template.badge.size}
											onChange={(event) =>
												setTemplate({
													...template,
													badge: { ...template.badge!, size: Number(event.target.value) },
												})
											}
										/>
									</label>
									<label>
										Circle color
										<input
											type="color"
											value={template.badge.color}
											onChange={(event) =>
												setTemplate({
													...template,
													badge: { ...template.badge!, color: event.target.value },
												})
											}
										/>
									</label>
									<label>
										Number color
										<input
											type="color"
											value={template.badge.textColor}
											onChange={(event) =>
												setTemplate({
													...template,
													badge: { ...template.badge!, textColor: event.target.value },
												})
											}
										/>
									</label>
									<small>
										Numbers follow timeline order and update when cards move. Leave the start empty
										for automatic counting.
									</small>
								</>
							)}
						</details>
						<details>
							<summary>Customize template</summary>
							<label>
								Font
								<select
									aria-label="Font"
									value={template.font ?? "Arial"}
									onChange={(event) =>
										setTemplate({ ...template, font: event.target.value as CardTemplate["font"] })
									}
								>
									{["Arial", "Verdana", "Georgia", "Impact"].map((font) => (
										<option key={font}>{font}</option>
									))}
								</select>
							</label>
							{[
								{
									key: "textScale",
									label: "Text size",
									min: 0.5,
									max: 1.5,
									step: 0.05,
									fallback: 1,
								},
								{
									key: "outline",
									label: "Text outline",
									min: 0,
									max: 0.15,
									step: 0.005,
									fallback: 0.065,
								},
								{
									key: "spacing",
									label: "Card spacing",
									min: 0.005,
									max: 0.06,
									step: 0.005,
									fallback: 0.028,
								},
								{
									key: "imageHeight",
									label: "Image height",
									min: 0.3,
									max: 0.65,
									step: 0.01,
									fallback: 0.52,
								},
							].map((control) => (
								<label key={control.key}>
									{control.label}
									<input
										type="range"
										min={control.min}
										max={control.max}
										step={control.step}
										value={
											(template[control.key as keyof CardTemplate] as number | undefined) ??
											control.fallback
										}
										onChange={(event) =>
											setTemplate({ ...template, [control.key]: Number(event.target.value) })
										}
									/>
								</label>
							))}
							<label>
								Text color
								<input
									type="color"
									value={template.textColor}
									onChange={(event) => setTemplate({ ...template, textColor: event.target.value })}
								/>
							</label>
							<label>
								Outline color
								<input
									type="color"
									value={template.outlineColor ?? "#131722"}
									onChange={(event) =>
										setTemplate({ ...template, outlineColor: event.target.value })
									}
								/>
							</label>
							{template.id.startsWith("custom-") && (
								<button
									type="button"
									onClick={() => {
										const list = custom.filter((item) => item.id !== template.id);
										try {
											localStorage.setItem("data-recruit-templates", JSON.stringify(list));
											setCustom(list);
											setTemplate(structuredClone(TEMPLATES[0]));
										} catch (error) {
											fail(error);
										}
									}}
								>
									Delete saved template
								</button>
							)}
							<label>
								Template name
								<input
									value={template.name}
									onChange={(event) => setTemplate({ ...template, name: event.target.value })}
								/>
							</label>
							<label>
								Title color
								<input
									aria-label="Title color"
									type="color"
									value={template.titleColor}
									onChange={(event) => setTemplate({ ...template, titleColor: event.target.value })}
								/>
							</label>
							{template.rows.map((row, index) => (
								<div className="dr-template-row" key={index}>
									<input
										aria-label={`Field ${index + 1}`}
										value={row.key}
										onChange={(event) =>
											setTemplate({
												...template,
												rows: template.rows.map((item, at) =>
													at === index
														? {
																...item,
																key: event.target.value.toLowerCase(),
																label: event.target.value.toUpperCase(),
															}
														: item,
												),
											})
										}
									/>
									<input
										aria-label={`${row.label} color`}
										type="color"
										value={row.color}
										onChange={(event) =>
											setTemplate({
												...template,
												rows: template.rows.map((item, at) =>
													at === index ? { ...item, color: event.target.value } : item,
												),
											})
										}
									/>
									<input
										type="color"
										aria-label={`${row.label} value color`}
										value={row.valueColor}
										onChange={(event) =>
											setTemplate({
												...template,
												rows: template.rows.map((item, at) =>
													at === index ? { ...item, valueColor: event.target.value } : item,
												),
											})
										}
									/>
									<button
										type="button"
										disabled={template.rows.length === 1}
										onClick={() =>
											setTemplate({
												...template,
												rows: template.rows.filter((_, at) => at !== index),
											})
										}
									>
										×
									</button>
								</div>
							))}
							<div className="dr-inline">
								<button
									type="button"
									disabled={template.rows.length >= 6}
									onClick={() =>
										setTemplate({
											...template,
											rows: [
												...template.rows,
												{
													key: `field ${template.rows.length + 1}`,
													label: `FIELD ${template.rows.length + 1}`,
													color: "#334765",
													valueColor: "#ffffff",
												},
											],
										})
									}
								>
									＋ Add field
								</button>
								<button
									type="button"
									onClick={() => {
										try {
											const value = templateSchema.parse({
												...template,
												id: template.id.startsWith("custom-")
													? template.id
													: `custom-${Date.now()}`,
											});
											if (new Set(value.rows.map((row) => row.key)).size !== value.rows.length)
												throw new Error("Each template field must have a unique name.");
											const list = [...custom.filter((item) => item.id !== value.id), value];
											localStorage.setItem("data-recruit-templates", JSON.stringify(list));
											setCustom(list);
											setTemplate(value);
											setMessage("Template saved for future projects.");
										} catch (error) {
											fail(error);
										}
									}}
								>
									Save template
								</button>
							</div>
						</details>
					</section>
					<section>
						<h2>
							<b>03</b> Your data
						</h2>
						<div className="dr-inline">
							<label className="dr-button">
								Import .txt
								<input
									type="file"
									accept=".txt"
									hidden
									onChange={async (event) => {
										const file = event.target.files?.[0];
										if (file) {
											try {
												setText(await file.text());
												setMessage(`${file.name} imported.`);
											} catch (error) {
												fail(error);
											}
										}
										event.target.value = "";
									}}
								/>
							</label>
							<button
								type="button"
								onClick={() =>
									download(
										new Blob([template.id === "facts" ? FACTS_TEXT : SAMPLE_TEXT], {
											type: "text/plain",
										}),
										"Data-Recruit-example.txt",
									)
								}
							>
								Example .txt ↓
							</button>
						</div>
						<textarea
							aria-label="Numbered card data"
							value={text}
							spellCheck={false}
							onChange={(event) => setText(event.target.value)}
						/>
						<small>Numbers match image filenames. Labels match template fields.</small>
					</section>
				</aside>
				<main className="dr-main">
					<div className="dr-preview-heading">
						<div>
							<span className="dr-eyebrow">LIVE PREVIEW</span>
							<h1>{template.name}</h1>
						</div>
						<span className="dr-chip">
							{exportGeometry(settings.format, exportOptions).width} ×{" "}
							{exportGeometry(settings.format, exportOptions).height} · {exportOptions.fps} FPS
						</span>
					</div>
					<div className={`dr-stage ${settings.format}`}>
						<canvas ref={canvasRef} width={dims.width} height={dims.height} />
					</div>
					<div className="dr-player">
						<button
							type="button"
							disabled={busy || audioLoading}
							onClick={() => {
								if (playing) {
									setTime(livePosition.current);
									setPlaying(false);
								} else if (ensureReady()) {
									if (time >= total) setTime(0);
									setPlaying(true);
								}
							}}
						>
							{playing ? "Ⅱ Pause" : "▶ Play"}
						</button>
						<span>
							{clock(time)} <em>/ {clock(total)}</em>
						</span>
						<button
							type="button"
							disabled={busy || audioLoading}
							onClick={() => {
								setPlaying(false);
								setTime(0);
							}}
						>
							↺ Start
						</button>
					</div>
					<label
						className="dr-preview-volume"
						title="Listening volume only. Does not change exported audio."
					>
						Preview volume{" "}
						<input
							aria-label="Preview volume"
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={previewVolume}
							onChange={(event) => {
								const value = Number(event.target.value);
								setPreviewVolume(value);
								try {
									localStorage.setItem("data-recruit-preview-volume", String(value));
								} catch {
									/* Session setting still works. */
								}
							}}
						/>{" "}
						{Math.round(previewVolume * 100)}%<small>Listening only · export unchanged</small>
					</label>
					<div className="dr-timeline">
						<div className="dr-section-title">
							{built ? "YOUR TIMELINE" : "TIMELINE PREVIEW"}
							<span>
								{parsed.cards.length} cards · {clock(total)}
							</span>
						</div>
						<input
							aria-label="Timeline position"
							type="range"
							min="0"
							max={total}
							step="0.01"
							value={time}
							onChange={(event) => {
								setPlaying(false);
								setTime(Number(event.target.value));
							}}
						/>
						<div className="dr-track">
							{intro && (
								<button type="button" onClick={() => setTime(0)} className="dr-bookend">
									Intro
								</button>
							)}
							{parsed.cards.map((card, index) => (
								<button
									type="button"
									key={card.id}
									onClick={() => {
										setSelected(card.id);
										setPlaying(false);
										setTime(
											Math.min(
												total,
												timing.motionStart +
													Math.max(
														0,
														(timing.initialX +
															index * timing.cardWidth -
															(timing.width - timing.cardWidth) / 2) /
															timing.speed,
													),
											),
										);
									}}
								>
									<span>#{card.id}</span>
									{card.fields.title || "Untitled"}
								</button>
							))}
							{outro && (
								<button
									type="button"
									onClick={() => setTime(timing.outroStart)}
									className="dr-bookend"
								>
									Outro
								</button>
							)}
						</div>
						<small>
							Cards remain editable in the builder. Continue in Editor renders the sequence as a
							video clip.
						</small>
					</div>
					<MusicTimeline
						clips={music}
						total={total}
						time={time}
						busy={busy || audioLoading}
						onChange={(clips) => {
							history.checkpoint();
							setMusic(clips);
						}}
						onFiles={(files, at) => void addMusicFiles(files, at)}
						onPick={
							window.electronAPI?.dataRecruitPickMusic ? (at) => void pickMusic(at) : undefined
						}
						onSeek={(at) => {
							setPlaying(false);
							setTime(at);
						}}
					/>
					<div className="dr-status" role="status">
						{message}
						<small className="dr-recovery-status">
							{dirty ? "Unsaved project · " : ""}
							{recoveryStatus}
						</small>
					</div>
					{busy && (
						<div className="dr-progress">
							<progress value={progress} max="1" />
							<span>Rendering {Math.round(progress * 100)}%</span>
							<button type="button" onClick={() => abortRef.current?.abort()}>
								Cancel
							</button>
						</div>
					)}
				</main>
				<aside className="dr-inspector">
					<div className="dr-section-title">SCROLL & FINISH</div>
					<section>
						<h2>Movement</h2>
						<label>
							Seconds per card <strong>{settings.secondsPerCard}s</strong>
							<input
								type="range"
								min="1"
								max="20"
								step="0.5"
								value={settings.secondsPerCard}
								onChange={(event) =>
									setSettings({ ...settings, secondsPerCard: Number(event.target.value) })
								}
							/>
						</label>
						<label>
							Direction
							<select
								value={settings.direction}
								onChange={(event) =>
									setSettings({
										...settings,
										direction: event.target.value as ScrollSettings["direction"],
									})
								}
							>
								<option value="left">← Scroll left</option>
								<option value="right">Scroll right →</option>
							</select>
						</label>
						<label>
							Image fitting
							<select
								value={settings.fit}
								onChange={(event) =>
									setSettings({ ...settings, fit: event.target.value as ScrollSettings["fit"] })
								}
							>
								<option value="fill">Fill · crop excess</option>
								<option value="fit">Fit · show whole image</option>
							</select>
						</label>
					</section>
					<section>
						<h2>Selected card {selected ? `#${selected}` : ""}</h2>
						{selectedCard ? (
							<div className="dr-fields">
								<div className="dr-card-actions">
									<button
										type="button"
										disabled={parsed.cards.findIndex((c) => c.id === selected) === 0}
										onClick={() => {
											const at = parsed.cards.findIndex((c) => c.id === selected);
											moveCard(selected, parsed.cards[at - 1]?.id);
										}}
									>
										← Earlier
									</button>
									<button
										type="button"
										disabled={parsed.cards.at(-1)?.id === selected}
										onClick={() => {
											const ids = parsed.cards.map((c) => c.id),
												at = ids.indexOf(selected!);
											[ids[at], ids[at + 1]] = [ids[at + 1], ids[at]];
											setOrder(ids);
										}}
									>
										Later →
									</button>
									<button
										type="button"
										disabled={parsed.cards.length >= 100}
										onClick={duplicateCard}
									>
										Duplicate card
									</button>
									<button
										type="button"
										onClick={() => {
											history.checkpoint();
											setText(cardsText(parsed.cards.filter((c) => c.id !== selected)));
											setImages(images.filter((i) => i.id !== selected));
											setOrder(order.filter((id) => id !== selected));
											setSelected(null);
										}}
									>
										Remove card
									</button>
								</div>
								<label className="dr-button">
									{chosen ? "Replace image" : "Add image for this card"}
									<input
										aria-label={`Replace image for card ${selected}`}
										type="file"
										accept="image/png,image/jpeg,image/webp"
										hidden
										onChange={(event) => {
											if (selected !== null) void replaceImage(event.target.files?.[0], selected);
											event.target.value = "";
										}}
									/>
								</label>
								{["title", "year", ...template.rows.map((row) => row.key)].map((key) => (
									<label key={key}>
										{key}
										<input
											value={selectedCard.fields[key] || ""}
											onChange={(event) => updateField(key, event.target.value)}
										/>
									</label>
								))}
							</div>
						) : (
							<small>Select a numbered image or timeline card.</small>
						)}
						{chosen && (
							<>
								<label>
									Crop left / right
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={chosen.x}
										onChange={(event) =>
											setImages(
												images.map((item) =>
													item.id === chosen.id ? { ...item, x: Number(event.target.value) } : item,
												),
											)
										}
									/>
								</label>
								<label>
									Crop up / down
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={chosen.y}
										onChange={(event) =>
											setImages(
												images.map((item) =>
													item.id === chosen.id ? { ...item, y: Number(event.target.value) } : item,
												),
											)
										}
									/>
								</label>
							</>
						)}
					</section>
					<section>
						<h2>
							Intro & outro <small>Optional</small>
						</h2>
						{(["intro", "outro"] as const).map((kind) => {
							const item = kind === "intro" ? intro : outro;
							const setter = kind === "intro" ? setIntro : setOutro;
							return (
								<div className="dr-bookend-control" key={kind}>
									{window.electronAPI?.dataRecruitPickBookend ? (
										<button
											type="button"
											className="dr-button"
											aria-label={`Choose ${kind} image or video`}
											onClick={() => void pickBookend(kind)}
										>
											＋ {item?.name || `Add ${kind} image or video`}
										</button>
									) : (
										<label className="dr-button">
											＋ {item?.name || `Add ${kind} image or video`}
											<input
												type="file"
												aria-label={`Choose ${kind} image or video`}
												accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,video/x-m4v"
												hidden
												onChange={(event) => {
													void addBookend(event.target.files?.[0], kind);
													event.target.value = "";
												}}
											/>
										</label>
									)}
									{item && (
										<>
											<label>
												{kind === "intro" ? "Intro exit effect" : "Outro entrance effect"}
												<select
													aria-label={`${kind} transition`}
													value={
														kind === "intro"
															? (item.transition ?? "none")
															: outroTransition(item.transition)
													}
													onChange={(event) =>
														setter({ ...item, transition: event.target.value as Transition })
													}
												>
													{(kind === "intro" ? INTRO_TRANSITIONS : OUTRO_TRANSITIONS).map(
														(effect) => (
															<option key={effect} value={effect}>
																{
																	{
																		none: "None",
																		fade: "Fade",
																		scroll: "Scroll with cards",
																		squeeze: "Squeeze & burst",
																		rise: "Rise up",
																		fall: "Go down",
																		ease: "Ease in",
																	}[effect]
																}
															</option>
														),
													)}
												</select>
											</label>
											{item.transition &&
												item.transition !== "none" &&
												item.transition !== "scroll" &&
												item.transition !== "squeeze" && (
													<label>
														Transition seconds
														<input
															aria-label={`${kind} transition seconds`}
															type="number"
															min="0.1"
															max="3"
															step="0.1"
															value={item.transitionSeconds ?? 0.75}
															onChange={(event) =>
																setter({
																	...item,
																	transitionSeconds: Math.max(
																		0.1,
																		Math.min(3, Number(event.target.value) || 0.75),
																	),
																})
															}
														/>
													</label>
												)}
										</>
									)}
									{item && (
										<small>
											{kind === "intro"
												? "Plays fully, then holds its final frame during the exit."
												: "Enters first, then plays for its full duration."}{" "}
											{(item.transition === "scroll" ||
												(kind === "intro" && item.transition === "squeeze")) &&
												"Movement follows card speed; adjust Seconds per card to change it."}
										</small>
									)}
									{item?.kind === "video" && (
										<>
											<label>
												Trim {kind} start
												<input
													type="number"
													min="0"
													step="0.1"
													max={Math.max(0, item.sourceDuration - 0.1)}
													value={item.start ?? 0}
													onChange={(event) => {
														const start = Math.max(
															0,
															Math.min(item.sourceDuration - 0.1, Number(event.target.value) || 0),
														);
														setter({
															...item,
															start,
															duration: Math.min(item.duration, item.sourceDuration - start),
														});
													}}
												/>
											</label>
											<label>
												Trim {kind} end
												<input
													type="number"
													min={(item.start ?? 0) + 0.1}
													max={item.sourceDuration}
													step="0.1"
													value={Number(((item.start ?? 0) + item.duration).toFixed(3))}
													onChange={(event) =>
														setter({
															...item,
															duration: Math.max(
																0.1,
																Math.min(item.sourceDuration, Number(event.target.value) || 0) -
																	(item.start ?? 0),
															),
														})
													}
												/>
											</label>
											<label>
												{kind} volume
												<input
													type="range"
													min="0"
													max="1"
													step="0.05"
													value={item.volume ?? 1}
													onChange={(event) =>
														setter({ ...item, volume: Number(event.target.value) })
													}
												/>
											</label>
										</>
									)}
									{item?.kind === "video" && (
										<label className="dr-mute">
											<input
												type="checkbox"
												checked={item.muted}
												onChange={(event) => setter({ ...item, muted: event.target.checked })}
											/>{" "}
											Mute {kind} audio
										</label>
									)}
									{item && (
										<div className="dr-inline">
											<label>
												Seconds
												<input
													aria-label={`${kind} seconds`}
													type="number"
													min="0.1"
													step="0.1"
													max={
														item.kind === "video"
															? Math.min(600, item.sourceDuration - (item.start ?? 0))
															: 30
													}
													value={Number(item.duration.toFixed(3))}
													onChange={(event) =>
														setter({
															...item,
															duration: Math.max(
																0.1,
																Math.min(
																	item.kind === "video"
																		? Math.min(600, item.sourceDuration - (item.start ?? 0))
																		: 30,
																	Number(event.target.value) || 0.1,
																),
															),
														})
													}
												/>
											</label>
											<button type="button" onClick={() => setter(null)}>
												Remove
											</button>
										</div>
									)}
								</div>
							);
						})}
						<small>
							Choose an image or video. Entrance and exit time is added to the timeline, so each
							bookend keeps its full playback duration. Desktop imports have no 100 MB limit. Media
							is kept by Data Recruit on this computer, including for saved projects.
						</small>
					</section>
					<section>
						<h2>Export settings</h2>
						<small>60 FPS is recommended for smooth scrolling.</small>
						<small>MP4 · H.264 video</small>
						<label>
							Resolution
							<select
								aria-label="Resolution"
								value={exportOptions.resolution}
								onChange={(event) =>
									setExportOptions({
										...exportOptions,
										resolution: Number(event.target.value) as ExportSettings["resolution"],
									})
								}
							>
								{[720, 1080, 1440].map((size) => (
									<option key={size} value={size}>
										{size}p
									</option>
								))}
							</select>
						</label>
						<label>
							Frame rate
							<select
								aria-label="Frame rate"
								value={exportOptions.fps}
								onChange={(event) =>
									setExportOptions({
										...exportOptions,
										fps: Number(event.target.value) as ExportSettings["fps"],
									})
								}
							>
								{[24, 30, 60].map((fps) => (
									<option key={fps} value={fps}>
										{fps} FPS
									</option>
								))}
							</select>
						</label>
						<label>
							Quality
							<select
								aria-label="Quality"
								value={exportOptions.quality}
								onChange={(event) =>
									setExportOptions({
										...exportOptions,
										quality: event.target.value as ExportSettings["quality"],
									})
								}
							>
								<option value="standard">Standard · smaller file</option>
								<option value="high">High</option>
							</select>
						</label>
					</section>
					<div className="dr-build">
						{problems.length > 0 && (
							<ul className="dr-errors">
								{problems.slice(0, 4).map((problem) => (
									<li key={problem}>{problem}</li>
								))}
								{problems.length > 4 && <li>And {problems.length - 4} more…</li>}
							</ul>
						)}
						<span>
							{problems.length
								? `${problems.length} item${problems.length === 1 ? "" : "s"} to check`
								: "✓ All entries matched"}
						</span>
						<button
							className="dr-primary"
							type="button"
							disabled={busy || audioLoading}
							onClick={build}
						>
							✦ Build Timeline
						</button>
						<button
							type="button"
							disabled={busy || !window.electronAPI?.dataRecruitSaveVideo}
							onClick={() => void exportVideo(true)}
						>
							Continue in Editor →
						</button>
					</div>
				</aside>
			</div>
		</div>
	);
}
