import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { createId } from "@/lib/ai-edition/document/ids";
import { withClipsChanged } from "@/lib/ai-edition/document/timeline";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { type Bookend, encodeScroll } from "./export";
import {
	type CardTemplate,
	FACTS_TEXT,
	geometry,
	imageNumber,
	parseCards,
	SAMPLE_TEXT,
	type ScrollSettings,
	scrollDuration,
	TEMPLATES,
	validateCards,
} from "./model";
import { type CardImage, drawImageFit, drawScroll, renderCard } from "./render";
import "./data-recruit.css";

const rowSchema = z.object({
	key: z.string().min(1),
	label: z.string().min(1),
	color: z.string().regex(/^#[0-9a-f]{6}$/i),
	valueColor: z.string().regex(/^#[0-9a-f]{6}$/i),
});
const templateSchema = z.object({
	id: z.string(),
	name: z.string().min(1),
	titleColor: z.string().regex(/^#[0-9a-f]{6}$/i),
	textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
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
		url: z.string().startsWith("data:image/"),
		duration: z.number().min(1).max(30),
	})
	.nullable();
const recipeSchema = z.object({
	version: z.literal(1),
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
export const loadImage = (url: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Could not decode an image. Use PNG, JPEG or WebP."));
		image.src = url;
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

export default function DataRecruit({ onOpenEditor }: { onOpenEditor?: () => void }) {
	const [text, setText] = useState(SAMPLE_TEXT);
	const [template, setTemplate] = useState<CardTemplate>(structuredClone(TEMPLATES[0]));
	const [custom, setCustom] = useState<CardTemplate[]>(() => {
		try {
			return z
				.array(templateSchema)
				.parse(JSON.parse(localStorage.getItem("data-recruit-templates") || "[]"));
		} catch {
			return [];
		}
	});
	const [images, setImages] = useState<CardImage[]>([]);
	const [settings, setSettings] = useState<ScrollSettings>({
		format: "landscape",
		direction: "left",
		secondsPerCard: 4,
		fit: "fill",
	});
	const [intro, setIntro] = useState<Bookend | null>(null),
		[outro, setOutro] = useState<Bookend | null>(null);
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
			return { cards: parseCards(text), error: "" };
		} catch (error) {
			return { cards: [], error: String(error instanceof Error ? error.message : error) };
		}
	}, [text]);
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
			parsed.cards.map((card) =>
				renderCard(
					card,
					images.find((image) => image.id === card.id),
					template,
					settings,
				),
			),
		[parsed.cards, images, template, settings],
	);
	const scroll = scrollDuration(rendered.length, settings),
		introTime = intro?.duration ?? 0;
	const total = introTime + scroll + (outro?.duration ?? 0);
	const dims = geometry(settings.format);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Any source edit invalidates the built timeline.
	useEffect(() => {
		setBuilt(false);
		setPlaying(false);
		setTime(0);
	}, [text, images, template, settings, intro, outro]);
	useEffect(() => {
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		if (intro && time < introTime)
			drawImageFit(ctx, intro.image, 0, 0, dims.width, dims.height, "fit");
		else if (outro && time >= introTime + scroll)
			drawImageFit(ctx, outro.image, 0, 0, dims.width, dims.height, "fit");
		else drawScroll(ctx, rendered, Math.max(0, time - introTime), settings);
	}, [time, rendered, intro, outro, introTime, scroll, settings, dims.width, dims.height]);
	useEffect(() => {
		if (!playing) return;
		let frame = 0;
		let previous = performance.now();
		const tick = (now: number) => {
			const delta = (now - previous) / 1000;
			previous = now;
			setTime((value) => {
				const next = Math.min(total, value + delta);
				if (next === total) setPlaying(false);
				return next;
			});
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [playing, total]);
	useEffect(() => () => abortRef.current?.abort(), []);
	const fail = (error: unknown) =>
		setMessage(error instanceof Error ? error.message : String(error));
	async function importImages(files: File[]) {
		try {
			if (files.length > 100) throw new Error("Select up to 100 images per project.");
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
			setImages(loaded.sort((a, b) => a.id - b.id));
			setSelected(loaded[0]?.id ?? null);
			setMessage(`${loaded.length} numbered images loaded.`);
		} catch (error) {
			fail(error);
		}
	}
	async function addBookend(file: File | undefined, kind: "intro" | "outro") {
		if (!file) return;
		try {
			const url = await readUrl(file);
			const value = { image: await loadImage(url), name: file.name, url, duration: 3 };
			(kind === "intro" ? setIntro : setOutro)(value);
		} catch (error) {
			fail(error);
		}
	}
	function recipe() {
		return {
			version: 1,
			text,
			template,
			settings,
			images: images.map(({ image: _image, ...value }) => value),
			intro: intro ? { name: intro.name, url: intro.url, duration: intro.duration } : null,
			outro: outro ? { name: outro.name, url: outro.url, duration: outro.duration } : null,
		};
	}
	async function openRecipe(file: File | undefined) {
		if (!file) return;
		try {
			const value = recipeSchema.parse(JSON.parse(await file.text()));
			if (new Set(value.images.map((image) => image.id)).size !== value.images.length)
				throw new Error("Project contains duplicate image numbers.");
			const loaded = await Promise.all(
				value.images.map(async (image) => ({ ...image, image: await loadImage(image.url) })),
			);
			const loadBookend = async (item: typeof value.intro) =>
				item ? { ...item, image: await loadImage(item.url) } : null;
			const [first, last] = await Promise.all([loadBookend(value.intro), loadBookend(value.outro)]);
			setText(value.text);
			setTemplate(value.template);
			setSettings(value.settings);
			setImages(loaded);
			setIntro(first);
			setOutro(last);
			setMessage("Project opened. Click Build Timeline when ready.");
		} catch (error) {
			fail(error);
		}
	}
	function build() {
		if (problems.length) {
			setMessage(problems.slice(0, 5).join(" "));
			return;
		}
		if (total > 1200) {
			setMessage("This project exceeds 20 minutes. Increase the speed or use fewer cards.");
			return;
		}
		setBuilt(true);
		setTime(introTime);
		setPlaying(true);
		setMessage("Timeline built. Preview the scroll, export MP4, or continue in the editor.");
	}
	async function exportVideo(editor = false) {
		if (busy || !built) return;
		setBusy(true);
		setPlaying(false);
		setProgress(0);
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const bytes = await encodeScroll(
				rendered,
				settings,
				intro,
				outro,
				setProgress,
				controller.signal,
			);
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
				const doc = store().document;
				if (!asset || !doc) throw new Error("Could not add the generated video to the editor.");
				const next = withClipsChanged(doc, [
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
						embeddedAudioMuted: true,
					},
				]);
				next.legacyEditor = {
					...next.legacyEditor,
					aspectRatio: settings.format === "shorts" ? "9:16" : "16:9",
					padding: 0,
					borderRadius: 0,
					shadowIntensity: 0,
				};
				if (!(await store().saveDocument(next, { history: false })))
					throw new Error("Could not save the editor timeline.");
				onOpenEditor?.();
			} else {
				download(new Blob([bytes], { type: "video/mp4" }), "Data-Recruit.mp4");
				setMessage("MP4 ready. Save your project too if you want to change the cards later.");
			}
		} catch (error) {
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
	return (
		<div className="dr-app">
			<header className="dr-header">
				<div className="dr-brand">
					<span className="dr-logo">
						D<span>R</span>
					</span>
					<div>
						Data Recruit<small>SCROLLING VIDEO STUDIO</small>
					</div>
				</div>
				<nav>
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
					<button
						type="button"
						onClick={() =>
							download(
								new Blob([JSON.stringify(recipe())], { type: "application/json" }),
								"Data-Recruit.project.json",
							)
						}
					>
						Save project
					</button>
					<button
						className="dr-primary"
						type="button"
						disabled={!built || busy}
						onClick={() => void exportVideo()}
					>
						Export MP4 ↗
					</button>
				</nav>
			</header>
			<div className="dr-workspace">
				<aside className="dr-sidebar">
					<div className="dr-section-title">
						CREATE YOUR VIDEO <span>01—03</span>
					</div>
					<section>
						<h2>
							<b>01</b> Images
						</h2>
						<label className="dr-drop">
							＋ Select numbered images<small>1.jpg, 2.jpg, 3.jpg · PNG / JPG / WebP</small>
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
						<div className="dr-images">
							{images.map((image) => (
								<button
									type="button"
									key={image.id}
									className={selected === image.id ? "selected" : ""}
									title={image.name}
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
								const next = [...TEMPLATES, ...custom].find(
									(item) => item.id === event.target.value,
								);
								if (next) setTemplate(structuredClone(next));
							}}
						>
							{[...TEMPLATES, ...custom].map((item) => (
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
							<summary>Customize template</summary>
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
												id: `custom-${Date.now()}`,
											});
											if (new Set(value.rows.map((row) => row.key)).size !== value.rows.length)
												throw new Error("Each template field must have a unique name.");
											const list = [...custom, value];
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
							{dims.width} × {dims.height} · 30 FPS
						</span>
					</div>
					<div className={`dr-stage ${settings.format}`}>
						<canvas ref={canvasRef} width={dims.width} height={dims.height} />
					</div>
					<div className="dr-player">
						<button
							type="button"
							disabled={!built || busy}
							onClick={() => {
								if (time >= total) setTime(0);
								setPlaying(!playing);
							}}
						>
							{playing ? "Ⅱ Pause" : "▶ Play"}
						</button>
						<span>
							{clock(time)} <em>/ {clock(total)}</em>
						</span>
						<button
							type="button"
							disabled={!built}
							onClick={() => {
								setPlaying(false);
								setTime(0);
							}}
						>
							↺ Start
						</button>
					</div>
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
											introTime +
												1 +
												(index / Math.max(1, parsed.cards.length - 1)) * Math.max(0, scroll - 2),
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
									onClick={() => setTime(introTime + scroll)}
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
					<div className="dr-status" role="status">
						{message}
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
									<label className="dr-button">
										＋ {item?.name || `Add ${kind} image`}
										<input
											type="file"
											accept="image/png,image/jpeg,image/webp"
											hidden
											onChange={(event) => {
												void addBookend(event.target.files?.[0], kind);
												event.target.value = "";
											}}
										/>
									</label>
									{item && (
										<div className="dr-inline">
											<label>
												Seconds
												<input
													aria-label={`${kind} seconds`}
													type="number"
													min="1"
													max="30"
													value={item.duration}
													onChange={(event) =>
														setter({
															...item,
															duration: Math.max(1, Math.min(30, Number(event.target.value) || 1)),
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
							Use image bookends here. Add video intros, music and narration in the editor.
						</small>
					</section>
					<div className="dr-build">
						<span>
							{problems.length
								? `${problems.length} item${problems.length === 1 ? "" : "s"} to check`
								: "✓ All entries matched"}
						</span>
						<button className="dr-primary" type="button" disabled={busy} onClick={build}>
							✦ Build Timeline
						</button>
						<button
							type="button"
							disabled={!built || busy || !window.electronAPI?.dataRecruitSaveVideo}
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
