// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DataRecruit from "./DataRecruit";
import { encodeScroll } from "./export";

vi.mock("./export", () => ({
	encodeScroll: vi.fn(async () => ({ bytes: new ArrayBuffer(8), hasAudio: false })),
}));
vi.mock("./sequence", () => ({ drawSequence: vi.fn() }));
vi.mock("./render", () => ({
	renderCard: () => document.createElement("canvas"),
	drawImageFit: vi.fn(),
	drawScroll: vi.fn(),
}));
vi.mock("./bookends", async (original) => ({
	...(await original<typeof import("./bookends")>()),
	loadImage: vi.fn(async () => new Image()),
}));
vi.mock("@/lib/ai-edition/store/projectStore", () => ({ useProjectStore: { getState: vi.fn() } }));
const validText = "1\nTitle: First\nBudget: $1M\nBox Office: $5M\nPaycheck: $100K";

beforeEach(() => {
	localStorage.clear();
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
		{} as CanvasRenderingContext2D,
	);
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	window.electronAPI = {
		dataRecruitExportVideo: vi.fn(async () => "C:/Videos/example.mp4"),
	} as unknown as Window["electronAPI"];
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});
async function setup() {
	const view = render(<DataRecruit />);
	fireEvent.change(screen.getByLabelText("Numbered card data"), { target: { value: validText } });
	await act(async () => {
		fireEvent.change(view.container.querySelector("input[multiple]")!, {
			target: { files: [new File(["image"], "1.png", { type: "image/png" })] },
		});
	});
	await waitFor(() => expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(1));
	return view;
}
describe("builder actions", () => {
	it("explains missing input instead of leaving Play and Export disabled", () => {
		render(<DataRecruit />);
		const play = screen.getByRole("button", { name: /Play/ });
		expect((play as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(play);
		expect(screen.getByRole("status").textContent).toContain("image missing");
	});
	it("plays without a separate build and exports the latest text after edits", async () => {
		await setup();
		fireEvent.click(screen.getByRole("button", { name: /Play/ }));
		expect(screen.getByRole("button", { name: /Pause/ })).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Numbered card data"), {
			target: { value: validText.replace("First", "Updated") },
		});
		const button = screen.getByRole("button", { name: /Export MP4/ });
		expect((button as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(button);
		await waitFor(() => expect(encodeScroll).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(screen.getByRole("status").textContent).toContain("Saved to C:/Videos/example.mp4"),
		);
	});
	it("replaces a selected card using any filename while keeping its number", async () => {
		const view = await setup();
		await act(async () => {
			fireEvent.change(screen.getByLabelText("Replace image for card 1"), {
				target: { files: [new File(["new"], "correct-photo.jpg", { type: "image/jpeg" })] },
			});
		});
		await waitFor(() =>
			expect(view.container.querySelector(".dr-images img")?.getAttribute("alt")).toBe(
				"correct-photo.jpg",
			),
		);
		expect(view.container.querySelector(".dr-images button span")?.textContent).toBe("1");
	});
	it("merges a numbered image import without discarding earlier cards", async () => {
		const view = await setup();
		await act(async () => {
			fireEvent.change(view.container.querySelector("input[multiple]")!, {
				target: { files: [new File(["new"], "2.png", { type: "image/png" })] },
			});
		});
		await waitFor(() =>
			expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(2),
		);
	});
});

it("duplicates and removes cards while undo restores the image and text together", async () => {
	const view = await setup();
	fireEvent.click(screen.getByRole("button", { name: "Duplicate card" }));
	expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(2);
	expect((screen.getByLabelText("Numbered card data") as HTMLTextAreaElement).value).toContain(
		"2\n",
	);
	fireEvent.click(screen.getByRole("button", { name: "Undo" }));
	expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(1);
	expect(screen.getByLabelText("Replace image for card 1")).toBeTruthy();
	expect(screen.getByLabelText("Crop left / right")).toBeTruthy();
	expect(screen.getByLabelText("Crop up / down")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Redo" }));
	fireEvent.click(screen.getByRole("button", { name: "Remove card" }));
	expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(1);
});
it("updates a custom template by name and removes it from saved choices", async () => {
	render(<DataRecruit />);
	fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "My ranking" } });
	fireEvent.change(screen.getByLabelText("Font"), { target: { value: "Georgia" } });
	fireEvent.click(screen.getByRole("button", { name: "Save template" }));
	fireEvent.change(screen.getByLabelText("Template name"), {
		target: { value: "Renamed ranking" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save template" }));
	const list = JSON.parse(localStorage.getItem("data-recruit-templates")!);
	expect(list).toHaveLength(1);
	expect(list[0]).toMatchObject({ name: "Renamed ranking", font: "Georgia" });
	fireEvent.click(screen.getByRole("button", { name: "Delete saved template" }));
	expect(JSON.parse(localStorage.getItem("data-recruit-templates")!)).toHaveLength(0);
});
