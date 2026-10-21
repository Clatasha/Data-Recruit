// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type AxcutDocument, assetSchema, createEmptyDocument } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { useChatPromptBus } from "@/lib/ai-edition/store/useChatPromptBus";

vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
vi.mock("./LeftPanel", () => ({ ChatStripPanel: () => <div>Actual AI chat</div> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { LibraryPanel } from "./LibraryPanel";

function fixture() {
	const doc = createEmptyDocument({ projectId: "bin", title: "Reaction" });
	doc.assets = [
		assetSchema.parse({
			id: "video",
			origin: "user",
			kind: "video",
			label: "Reaction.mp4",
			originalPath: "/reaction.mp4",
			durationSec: 20,
		}),
		assetSchema.parse({
			id: "music",
			origin: "user",
			kind: "audio",
			label: "Music.wav",
			originalPath: "/music.wav",
			durationSec: 20,
		}),
		assetSchema.parse({
			id: "sticker",
			origin: "user",
			label: "Smile.png",
			originalPath: "/smile.mp4",
			stillImagePath: "/smile.png",
			libraryCategory: "sticker",
		}),
	];
	return doc;
}
const add = vi.fn(async () => {
	/* Record the reusable media placement. */
});
const edit = vi.fn(async (update: (doc: AxcutDocument) => AxcutDocument) => {
	const state = useProjectStore.getState();
	if (state.document) useProjectStore.setState({ document: update(state.document) });
});
beforeEach(() => {
	useProjectStore.setState({ document: fixture(), projectId: "bin" });
	useChatPromptBus.setState({ pending: null });
	add.mockClear();
	edit.mockClear();
});
afterEach(cleanup);
it("shows media names, filters search, and adds the same media more than once", () => {
	render(<LibraryPanel onAdd={add} editDocument={edit} />);
	expect(screen.getByText("Reaction.mp4")).toBeVisible();
	expect(screen.queryByText("Smile.png")).not.toBeInTheDocument();
	const video = screen.getByTitle("Reaction.mp4");
	fireEvent.doubleClick(video);
	fireEvent.doubleClick(video);
	expect(add).toHaveBeenCalledTimes(2);
	fireEvent.change(screen.getByRole("textbox", { name: "library.search" }), {
		target: { value: "Music" },
	});
	expect(screen.queryByText("Reaction.mp4")).not.toBeInTheDocument();
	expect(screen.getByText("Music.wav")).toBeVisible();
});
it("drags a reusable asset reference and keeps custom stickers in their tab", () => {
	render(<LibraryPanel onAdd={add} editDocument={edit} />);
	const setData = vi.fn();
	fireEvent.dragStart(screen.getByTitle("Reaction.mp4"), {
		dataTransfer: { clearData: vi.fn(), setData, effectAllowed: "" },
	});
	expect(setData).toHaveBeenCalledWith("application/x-axcut-asset", "video");
	fireEvent.click(screen.getByRole("tab", { name: "library.stickers" }));
	expect(screen.getByText("Smile.png")).toBeVisible();
	expect(screen.queryByText("Reaction.mp4")).not.toBeInTheDocument();
});
it("starts with AI collapsed and opens the real chat for a pending prompt", async () => {
	render(<LibraryPanel onAdd={add} editDocument={edit} />);
	expect(screen.queryByText("Actual AI chat")).not.toBeInTheDocument();
	act(() => useChatPromptBus.setState({ pending: "Help edit this reaction" }));
	expect(await screen.findByText("Actual AI chat")).toBeVisible();
});
it("marks unreadable media and relinks the existing asset without replacing its identity", async () => {
	const replacement = assetSchema.parse({
		id: "replacement",
		origin: "user",
		label: "Found.mp4",
		originalPath: "/new/reaction.mp4",
		durationSec: 20,
	});
	const importAsset = vi.fn(async () => {
		const state = useProjectStore.getState();
		useProjectStore.setState({
			document: { ...state.document!, assets: [...state.document!.assets, replacement] },
		});
		return replacement;
	});
	useProjectStore.setState({ addAsset: importAsset });
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: { getPathForFile: () => "/new/reaction.mp4" },
	});
	const { container } = render(<LibraryPanel onAdd={add} editDocument={edit} />);
	fireEvent.error(container.querySelector("video")!);
	fireEvent.contextMenu(screen.getByTitle("Reaction.mp4"));
	fireEvent.click(await screen.findByRole("menuitem", { name: "library.locateFile" }));
	fireEvent.change(container.querySelector('input[type="file"]')!, {
		target: { files: [new File(["video"], "Found.mp4", { type: "video/mp4" })] },
	});
	await waitFor(() =>
		expect(
			useProjectStore.getState().document?.assets.find((asset) => asset.id === "video")
				?.originalPath,
		).toBe("/new/reaction.mp4"),
	);
	expect(
		useProjectStore.getState().document?.assets.some((asset) => asset.id === "replacement"),
	).toBe(false);
	expect(screen.getByText("Reaction.mp4")).toBeVisible();
});

it("renders safely before a project is loaded", () => {
	useProjectStore.setState({ document: null });
	render(<LibraryPanel onAdd={add} editDocument={edit} />);
	expect(screen.getByRole("textbox", { name: "library.search" })).toBeVisible();
	expect(screen.queryByText("Actual AI chat")).not.toBeInTheDocument();
});

it("keeps Locate and Replace in the media context menu", async () => {
	render(<LibraryPanel onAdd={add} editDocument={edit} />);
	expect(screen.queryByText("library.locate")).not.toBeInTheDocument();
	fireEvent.contextMenu(screen.getByTitle("Music.wav"));
	expect(await screen.findByRole("menuitem", { name: "library.locateFile" })).toBeVisible();
	expect(screen.getByRole("menuitem", { name: "library.replaceFile" })).toBeVisible();
});

it("deletes the selected bin entry through its context menu and retains its source metadata", async () => {
	render(<LibraryPanel onAdd={add} editDocument={edit} />);
	fireEvent.contextMenu(screen.getByTitle("Reaction.mp4"));
	fireEvent.click(await screen.findByRole("menuitem", { name: "library.delete" }));
	await waitFor(() => expect(screen.queryByTitle("Reaction.mp4")).not.toBeInTheDocument());
	expect(
		useProjectStore.getState().document?.assets.find((asset) => asset.id === "video"),
	).toMatchObject({ libraryHidden: true, originalPath: "/reaction.mp4" });
	expect(edit).toHaveBeenCalledTimes(1);
});

it("imports stickers through native paths without depending on browser File metadata", async () => {
	const sticker = assetSchema.parse({
		id: "native-sticker",
		origin: "user",
		kind: "video",
		label: "Overlay.png",
		originalPath: "/cache/still.webm",
		stillImagePath: "/pictures/Overlay.png",
	});
	const importAsset = vi.fn(async () => {
		const doc = useProjectStore.getState().document!;
		useProjectStore.setState({ document: { ...doc, assets: [...doc.assets, sticker] } });
		return sticker;
	});
	useProjectStore.setState({ addAsset: importAsset });
	const picker = vi.fn(async () => ({
		success: true,
		files: [{ name: "Overlay.png", path: "/pictures/Overlay.png" }],
	}));
	const getPathForFile = vi.fn(() => "");
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: { openLibraryFilePicker: picker, getPathForFile },
	});
	render(<LibraryPanel onAdd={add} editDocument={edit} />);
	fireEvent.click(screen.getByRole("tab", { name: "library.stickers" }));
	fireEvent.click(screen.getByTitle("library.import"));
	await waitFor(() =>
		expect(screen.getByTitle("Overlay.png")).toHaveAttribute("draggable", "true"),
	);
	expect(picker).toHaveBeenCalledWith(true, true);
	expect(importAsset).toHaveBeenCalledWith("/pictures/Overlay.png", "Overlay.png");
	expect(getPathForFile).not.toHaveBeenCalled();
	expect(
		useProjectStore.getState().document?.assets.find((asset) => asset.id === sticker.id)
			?.libraryCategory,
	).toBe("sticker");
});
