import { Import, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useScopedT } from "@/contexts/I18nContext";
import { relinkEditorAsset, removeLibraryAsset } from "@/lib/ai-edition/document/editorTracks";
import type { AxcutAsset, AxcutDocument } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { useChatPromptBus } from "@/lib/ai-edition/store/useChatPromptBus";
import { droppedMediaKind } from "@/lib/ai-edition/timeline/mediaDrop";
import { moveMenuFocus } from "@/lib/menuKeyboard";
import { ChatStripPanel } from "./LeftPanel";
import styles from "./LibraryPanel.module.css";
import { MediaThumbnail } from "./MediaThumbnail";

const EMPTY_ASSETS: AxcutAsset[] = [];

export function LibraryPanel({
	onAdd,
	editDocument,
}: {
	onAdd: (assetId: string) => Promise<void>;
	editDocument: (edit: (doc: AxcutDocument) => AxcutDocument) => Promise<void>;
}) {
	const t = useScopedT("editor");
	const assets = useProjectStore((state) => state.document?.assets ?? EMPTY_ASSETS);
	const prompt = useChatPromptBus((state) => state.pending);
	const [chatExpanded, setChatExpanded] = useState(false);
	useEffect(() => {
		if (prompt) setChatExpanded(true);
	}, [prompt]);
	const [query, setQuery] = useState("");
	const [tab, setTab] = useState<"media" | "sticker">("media");
	const [filter, setFilter] = useState("all");
	const [missing, setMissing] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const [context, setContext] = useState<{ asset: AxcutAsset; x: number; y: number } | null>(null);
	const lastContext = useRef(context);
	if (context) lastContext.current = context;
	const displayedContext = context ?? lastContext.current;
	const anchor = useRef({ getBoundingClientRect: () => new DOMRect(0, 0, 0, 0) });
	anchor.current.getBoundingClientRect = () =>
		new DOMRect(displayedContext?.x ?? 0, displayedContext?.y ?? 0, 0, 0);
	const picker = useRef<HTMLInputElement>(null);
	const relinkId = useRef<string>();
	const importPaths = async (files: Array<{ name: string; path: string }>) => {
		setBusy(true);
		const project = useProjectStore.getState().projectId;
		try {
			for (const file of files) {
				const kind = droppedMediaKind(file.name);
				if (!kind || (tab === "sticker" && kind !== "image"))
					throw new Error(t("library.unsupported"));
				const path = file.path;
				if (!path) throw new Error(t("library.unreadable"));
				const state = useProjectStore.getState();
				const old = state.document?.assets.find((asset) => asset.id === relinkId.current);
				if (old && (old.kind === "audio") !== (kind === "audio"))
					throw new Error(t("library.wrongType"));
				const asset =
					kind === "audio"
						? await state.addAudioAsset(path, file.name)
						: await state.addAsset(path, file.name);
				if (!asset || useProjectStore.getState().projectId !== project) return;
				await editDocument((doc) => {
					if (old) {
						return relinkEditorAsset(doc, old.id, asset);
					}
					return {
						...doc,
						assets: doc.assets.map((a) => (a.id === asset.id ? { ...a, libraryCategory: tab } : a)),
					};
				});
				if (old)
					setMissing((previous) => {
						const next = new Set(previous);
						next.delete(old.id);
						return next;
					});
			}
		} catch (error) {
			console.error("[library] Import failed:", error);
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
			relinkId.current = undefined;
			if (picker.current) picker.current.value = "";
		}
	};
	const importFiles = async (files: File[]) => {
		await importPaths(
			files.map((file) => ({ name: file.name, path: window.electronAPI.getPathForFile(file) })),
		);
	};
	const choosingRef = useRef(false);
	const chooseFiles = async () => {
		if (choosingRef.current) return;
		if (!window.electronAPI?.openLibraryFilePicker) {
			picker.current?.click();
			return;
		}
		choosingRef.current = true;
		setBusy(true);
		try {
			const result = await window.electronAPI.openLibraryFilePicker(
				tab === "sticker",
				!relinkId.current,
			);
			if (result.success && result.files) await importPaths(result.files);
			else if (!result.canceled) throw new Error(result.message || t("library.unreadable"));
		} catch (error) {
			console.error("[library] Import failed:", error);
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			choosingRef.current = false;
			setBusy(false);
			relinkId.current = undefined;
		}
	};
	const locate = (asset: AxcutAsset) => {
		relinkId.current = asset.id;
		void chooseFiles();
	};
	const rows = assets.filter(
		(asset) =>
			!asset.libraryHidden &&
			(asset.libraryCategory ?? "media") === tab &&
			asset.label.toLowerCase().includes(query.toLowerCase()) &&
			(filter === "all" ||
				(filter === "image"
					? !!asset.stillImagePath
					: filter === "audio"
						? asset.kind === "audio"
						: asset.kind === "video" && !asset.stillImagePath)),
	);
	return (
		<section
			className={styles.library}
			aria-label={t("library.title")}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) {
					event.preventDefault();
					event.dataTransfer.dropEffect = "copy";
				}
			}}
			onDrop={(event) => {
				if (event.dataTransfer.files.length) {
					event.preventDefault();
					void importFiles(Array.from(event.dataTransfer.files));
				}
			}}
		>
			<Popover
				open={!!context}
				onOpenChange={(open) => {
					if (!open) setContext(null);
				}}
			>
				<PopoverAnchor virtualRef={anchor} />
				<PopoverContent
					className={styles.contextMenu}
					role="menu"
					align="start"
					sideOffset={0}
					onKeyDown={(event) => {
						if (event.key === "Escape") setContext(null);
						else moveMenuFocus(event);
						event.nativeEvent.stopPropagation();
					}}
				>
					{["locateFile", "replaceFile", "delete"].map((action) => (
						<button
							type="button"
							role="menuitem"
							key={action}
							disabled={busy}
							onClick={() => {
								if (
									displayedContext &&
									assets.some((asset) => asset.id === displayedContext.asset.id)
								) {
									if (action === "delete")
										void editDocument((doc) => removeLibraryAsset(doc, displayedContext.asset.id));
									else locate(displayedContext.asset);
								}
								setContext(null);
							}}
						>
							{t(`library.${action}`)}
						</button>
					))}
				</PopoverContent>
			</Popover>
			<div className={styles.header}>
				<h2>{t("library.title")}</h2>
				<button
					type="button"
					disabled={busy}
					onClick={() => {
						relinkId.current = undefined;
						void chooseFiles();
					}}
					title={t("library.import")}
				>
					<Import size={16} />
				</button>
			</div>
			<input
				ref={picker}
				hidden
				type="file"
				multiple
				accept="video/*,audio/*,image/*,.mkv,.flac,.opus"
				onChange={(event) =>
					void importFiles(
						relinkId.current
							? Array.from(event.target.files ?? []).slice(0, 1)
							: Array.from(event.target.files ?? []),
					)
				}
			/>
			<div className={styles.tabs} role="tablist">
				<button role="tab" aria-selected={tab === "media"} onClick={() => setTab("media")}>
					{t("library.media")}
				</button>
				<button role="tab" aria-selected={tab === "sticker"} onClick={() => setTab("sticker")}>
					{t("library.stickers")}
				</button>
			</div>
			<label className={styles.header}>
				<Search size={14} />
				<input
					aria-label={t("library.search")}
					placeholder={t("library.search")}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</label>
			<div className={styles.filters}>
				{["all", "video", "image", "audio"].map((kind) => (
					<button key={kind} aria-pressed={filter === kind} onClick={() => setFilter(kind)}>
						{t(`library.${kind}`)}
					</button>
				))}
			</div>
			<div className={styles.grid} data-testid="media-bin">
				{rows.map((asset) => (
					<div key={asset.id} className={styles.card}>
						<button
							type="button"
							draggable={!busy && !missing.has(asset.id)}
							title={asset.label}
							onContextMenu={(event) => {
								event.preventDefault();
								setContext({ asset, x: event.clientX, y: event.clientY });
							}}
							onKeyDown={(event) => {
								if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
									event.preventDefault();
									const rect = event.currentTarget.getBoundingClientRect();
									setContext({ asset, x: rect.left, y: rect.bottom });
								}
							}}
							onDoubleClick={() => {
								if (!busy && !missing.has(asset.id)) void onAdd(asset.id);
							}}
							onDragStart={(event) => {
								event.dataTransfer.clearData();
								event.dataTransfer.setData("application/x-axcut-asset", asset.id);
								event.dataTransfer.effectAllowed = "copy";
							}}
						>
							<div className={styles.thumb}>
								<MediaThumbnail
									asset={asset}
									onError={() => setMissing((previous) => new Set(previous).add(asset.id))}
								/>
							</div>
							<span>{asset.label}</span>
						</button>
						{missing.has(asset.id) ? (
							<span className={styles.missing}>{t("library.missing")}</span>
						) : null}
					</div>
				))}
				{!rows.length ? (
					<p className={styles.empty}>
						{t(tab === "sticker" ? "library.stickerEmpty" : "library.empty")}
					</p>
				) : null}
			</div>
			<details
				className={styles.chat}
				open={chatExpanded}
				onToggle={(event) => setChatExpanded(event.currentTarget.open)}
			>
				<summary>{t("library.aiChat")}</summary>
				<div className={styles.chatBody}>{chatExpanded ? <ChatStripPanel /> : null}</div>
			</details>
		</section>
	);
}
