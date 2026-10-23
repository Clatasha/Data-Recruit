// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBookend } from "./bookends";
import DataRecruit from "./DataRecruit";
import { encodeScroll } from "./export";
import { loadMusic } from "./music";
import { renderCard } from "./render";

vi.mock("./export", () => ({
	encodeScroll: vi.fn(async () => ({ bytes: new ArrayBuffer(8), hasAudio: false })),
}));
vi.mock("./sequence", () => ({ drawSequence: vi.fn() }));
vi.mock("./render", () => ({
	renderCard: vi.fn(() => document.createElement("canvas")),
	drawImageFit: vi.fn(),
	drawScroll: vi.fn(),
}));
vi.mock("./bookends", async (original) => ({
	...(await original<typeof import("./bookends")>()),
	loadImage: vi.fn(async () => new Image()),
	loadBookend: vi.fn(async (name: string, url: string) => ({
		name,
		url,
		kind: "image" as const,
		duration: 3,
		media: new Image(),
	})),
}));
vi.mock("./music", async (original) => ({
	...(await original<typeof import("./music")>()),
	loadMusic: vi.fn(async (name: string, url: string) => ({
		id: crypto.randomUUID(),
		name,
		url,
		at: 0,
		start: 0,
		end: 2,
		duration: 2,
		volume: 1,
		muted: false,
		loop: false,
		loopOffset: 0,
		fadeIn: 0,
		fadeOut: 0,
		peaks: [0.5],
		buffer: { duration: 2, numberOfChannels: 2, sampleRate: 48000 },
	})),
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
	it("keeps all 100 images when adding later batches and replacing a matching number", async () => {
		const view = render(<DataRecruit />);
		const input = view.container.querySelector("input[multiple]")!;
		for (const [start, count] of [
			[1, 12],
			[13, 38],
			[51, 50],
		]) {
			await act(async () => {
				fireEvent.change(input, {
					target: {
						files: Array.from(
							{ length: count },
							(_, index) => new File(["image"], `${start + index}.png`, { type: "image/png" }),
						),
					},
				});
			});
			await waitFor(() =>
				expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(
					start + count - 1,
				),
			);
			const grid = screen.getByRole("region", { name: "Added images" });
			expect(grid.classList.contains("dr-images-scroll")).toBe(start + count - 1 > 12);
			expect(screen.getByText("＋ Add more images")).toBeTruthy();
		}
		await act(async () => {
			fireEvent.change(input, {
				target: { files: [new File(["replacement"], "50 - corrected.png", { type: "image/png" })] },
			});
		});
		await waitFor(() =>
			expect(view.container.querySelector('img[alt="50 - corrected.png"]')).toBeTruthy(),
		);
		expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(100);
		expect(view.container.querySelector('img[alt="1.png"]')).toBeTruthy();
		expect(view.container.querySelector('img[alt="100.png"]')).toBeTruthy();
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

it("starts a new project without restarting and clears undo after confirming unsaved changes", async () => {
	const view = await setup();
	fireEvent.click(screen.getByRole("button", { name: "New project" }));
	expect(screen.getByRole("dialog", { name: "Start a new project?" })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(1);
	fireEvent.click(screen.getByRole("button", { name: "New project" }));
	fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));
	expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(0);
	expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
	expect(screen.getByRole("status").textContent).toContain("New project ready");
	await act(async () =>
		fireEvent.change(view.container.querySelector("input[multiple]")!, {
			target: { files: [new File(["image"], "5.png", { type: "image/png" })] },
		}),
	);
	await waitFor(() =>
		expect(view.container.querySelector('.dr-images img[alt="5.png"]')).toBeTruthy(),
	);
	expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(1);
});
it("offers squeeze for intro and ease in for outro with separate effect choices", async () => {
	await setup();
	for (const kind of ["intro", "outro"])
		await act(async () =>
			fireEvent.change(screen.getByLabelText(`Choose ${kind} image or video`), {
				target: { files: [new File(["image"], `${kind}.png`, { type: "image/png" })] },
			}),
		);
	const intro = (await screen.findByLabelText("intro transition")) as HTMLSelectElement;
	const outro = (await screen.findByLabelText("outro transition")) as HTMLSelectElement;
	expect(Array.from(intro.options).map((o) => o.value)).toContain("squeeze");
	expect(Array.from(outro.options).map((o) => o.value)).not.toContain("squeeze");
	expect(Array.from(outro.options).map((o) => o.value)).toContain("ease");
	fireEvent.change(intro, { target: { value: "scroll" } });
	expect(screen.queryByLabelText("intro transition seconds")).toBeNull();
	fireEvent.change(outro, { target: { value: "ease" } });
	expect(screen.getByLabelText("outro transition seconds")).toBeTruthy();
});

it("imports desktop compilations by managed reference without reading the complete file into the project", async () => {
	const pick = vi.fn(async () => ({
		name: "Large compilation.mp4",
		kind: "video" as const,
		url: "data-recruit-media:12345678-1234-1234-1234-123456789abc.mp4",
	}));
	window.electronAPI.dataRecruitPickBookend = pick;
	const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
	render(<DataRecruit />);
	fireEvent.click(screen.getByRole("button", { name: "Choose intro image or video" }));
	await screen.findByLabelText("intro transition");
	expect(pick).toHaveBeenCalledOnce();
	expect(loadBookend).toHaveBeenCalledWith(
		"Large compilation.mp4",
		"data-recruit-media:12345678-1234-1234-1234-123456789abc.mp4",
		"video",
	);
	expect(read).not.toHaveBeenCalled();
});

it("renumbers visible badges in timeline order and saves countdown styling with a template", async () => {
	await setup();
	fireEvent.click(screen.getByRole("button", { name: "Duplicate card" }));
	fireEvent.click(screen.getByLabelText("Show numbered circles"));
	fireEvent.change(screen.getByLabelText("Badge number order"), { target: { value: "down" } });
	let calls = vi.mocked(renderCard).mock.calls.slice(-2);
	expect(calls.map((call) => call[4])).toEqual([2, 1]);
	fireEvent.click(screen.getByRole("button", { name: /Earlier/ }));
	calls = vi.mocked(renderCard).mock.calls.slice(-2);
	expect(calls.map((call) => call[0].id)).toEqual([2, 1]);
	expect(calls.map((call) => call[4])).toEqual([2, 1]);
	fireEvent.change(screen.getByLabelText("Badge starting number"), { target: { value: "10" } });
	expect(
		vi
			.mocked(renderCard)
			.mock.calls.slice(-2)
			.map((call) => call[4]),
	).toEqual([10, 9]);
	fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Countdown" } });
	fireEvent.click(screen.getByRole("button", { name: "Save template" }));
	expect(JSON.parse(localStorage.getItem("data-recruit-templates")!)[0].badge).toMatchObject({
		direction: "down",
		start: 10,
	});
});
it("adds multiple music clips, edits and splits them, and exports clip levels independently of preview volume", async () => {
	await setup();
	await act(async () =>
		fireEvent.change(screen.getByLabelText("Add audio files"), {
			target: {
				files: [
					new File(["audio"], "first.wav", { type: "audio/wav" }),
					new File(["audio"], "second.wav", { type: "audio/wav" }),
				],
			},
		}),
	);
	await waitFor(() =>
		expect(screen.getAllByRole("button", { name: /Audio clip/ })).toHaveLength(2),
	);
	expect(loadMusic).toHaveBeenCalledTimes(2);
	fireEvent.click(screen.getByRole("button", { name: "Audio clip first.wav" }));
	fireEvent.change(screen.getByLabelText("Audio clip volume"), { target: { value: "0.3" } });
	fireEvent.change(screen.getByLabelText("Preview volume"), { target: { value: "0" } });
	fireEvent.change(screen.getByLabelText("Timeline position"), { target: { value: "1" } });
	fireEvent.click(screen.getByRole("button", { name: "Split at playhead" }));
	expect(screen.getAllByRole("button", { name: /Audio clip/ })).toHaveLength(3);
	fireEvent.click(screen.getByRole("button", { name: /Export MP4/ }));
	await waitFor(() => expect(encodeScroll).toHaveBeenCalledOnce());
	const clips = vi.mocked(encodeScroll).mock.calls[0][7]!;
	expect(clips).toHaveLength(3);
	expect(clips.map((clip) => clip.volume)).toEqual([0.3, 0.3, 1]);
	expect(clips.map((clip) => clip.at)).toEqual([0, 1, 2]);
	expect(localStorage.getItem("data-recruit-preview-volume")).toBe("0");
});

it("marks a desktop project saved only after the native write completes", async () => {
	await setup();
	let finish: (path: string) => void = () => {
		throw new Error("Save did not start");
	};
	const save = vi.fn(
		(_recipe: string) =>
			new Promise<string>((resolve) => {
				finish = resolve;
			}),
	);
	window.electronAPI.dataRecruitSaveProject = save;
	fireEvent.click(screen.getByRole("button", { name: "Save project" }));
	expect(screen.getByRole("status").textContent).toContain("Unsaved project");
	expect(
		(screen.getByRole("button", { name: "Saving project…" }) as HTMLButtonElement).disabled,
	).toBe(true);
	await act(async () => finish("C:/project.json"));
	expect(screen.getByRole("status").textContent).toContain("Project saved.");
	expect(screen.getByRole("status").textContent).not.toContain("Unsaved project");
	expect(JSON.parse(save.mock.calls[0][0]).images).toHaveLength(1);
});
it("keeps the current project when Save and start new is cancelled or fails", async () => {
	const view = await setup();
	const save = vi.fn(async (_recipe: string): Promise<string | null> => null);
	window.electronAPI.dataRecruitSaveProject = save;
	fireEvent.click(screen.getByRole("button", { name: "New project" }));
	fireEvent.click(screen.getByRole("button", { name: "Save and start new" }));
	await waitFor(() => expect(screen.getByRole("status").textContent).toContain("save cancelled"));
	expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(1);
	expect(screen.getByRole("dialog", { name: "Start a new project?" })).toBeTruthy();
	save.mockRejectedValueOnce(new Error("disk full"));
	fireEvent.click(screen.getByRole("button", { name: "Save and start new" }));
	await waitFor(() => expect(screen.getByRole("status").textContent).toContain("disk full"));
	expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(1);
	expect(screen.getByRole("status").textContent).toContain("Unsaved project");
});
it("keeps edits made while an earlier snapshot is being saved marked unsaved", async () => {
	await setup();
	let finish: (path: string) => void = () => {
		throw new Error("Save did not start");
	};
	window.electronAPI.dataRecruitSaveProject = vi.fn(
		(_recipe: string) =>
			new Promise<string>((resolve) => {
				finish = resolve;
			}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save project" }));
	fireEvent.change(screen.getByLabelText("Numbered card data"), {
		target: { value: validText.replace("First", "Later edit") },
	});
	await act(async () => finish("C:/project.json"));
	expect(screen.getByRole("status").textContent).toContain("Unsaved project");
});

it("reverses an existing 100-card project with image/text pairs and count-up badges, and restores the saved toggle", async () => {
	const view = await setup();
	await act(async () =>
		fireEvent.change(view.container.querySelector('input[multiple][accept^="image/"]')!, {
			target: {
				files: Array.from(
					{ length: 99 },
					(_, index) => new File(["image"], `${index + 2}.png`, { type: "image/png" }),
				),
			},
		}),
	);
	await waitFor(() =>
		expect(view.container.querySelectorAll(".dr-images button")).toHaveLength(100),
	);
	const text = Array.from(
		{ length: 100 },
		(_, index) =>
			`${index + 1}\nTitle: Card ${index + 1}\nBudget: $1M\nBox Office: $5M\nPaycheck: $100K`,
	).join("\n\n");
	fireEvent.change(screen.getByLabelText("Numbered card data"), { target: { value: text } });
	fireEvent.click(screen.getByLabelText("Show numbered circles"));
	fireEvent.click(screen.getByLabelText("Reverse card order"));
	const calls = vi.mocked(renderCard).mock.calls.slice(-100);
	expect(calls.map((call) => call[0].id)).toEqual(
		Array.from({ length: 100 }, (_, index) => 100 - index),
	);
	expect(
		calls.every(
			(call) => call[1]?.id === call[0].id && call[0].fields.title === `Card ${call[0].id}`,
		),
	).toBe(true);
	expect(calls.map((call) => call[4])).toEqual(
		Array.from({ length: 100 }, (_, index) => index + 1),
	);
	const save = vi.fn(async (_recipe: string) => "C:/project.json");
	window.electronAPI.dataRecruitSaveProject = save;
	fireEvent.click(screen.getByRole("button", { name: "Save project" }));
	await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Project saved."));
	const recipe = save.mock.calls[0][0];
	expect(JSON.parse(recipe).reverseOrder).toBe(true);
	expect(JSON.parse(recipe).text).toBe(text);
	const firstCanvas = vi.mocked(renderCard).mock.results.at(-100)!.value;
	fireEvent.click(screen.getByRole("button", { name: /Export MP4/ }));
	await waitFor(() => expect(encodeScroll).toHaveBeenCalledOnce());
	expect(vi.mocked(encodeScroll).mock.calls[0][0][0]).toBe(firstCanvas);
	await waitFor(() => expect(screen.getByRole("status").textContent).toContain("MP4 ready"));
	fireEvent.click(screen.getByLabelText("Reverse card order"));
	expect(view.container.querySelector(".dr-images span")?.textContent).toBe("1");
	fireEvent.click(screen.getByRole("button", { name: "Undo" }));
	expect(view.container.querySelector(".dr-images span")?.textContent).toBe("100");
	fireEvent.click(screen.getByRole("button", { name: "Redo" }));
	expect(view.container.querySelector(".dr-images span")?.textContent).toBe("1");
	const file = new File([], "project.json", { type: "application/json" });
	Object.defineProperty(file, "text", { value: async () => recipe });
	await act(async () =>
		fireEvent.change(view.container.querySelector('input[accept=".json"]')!, {
			target: { files: [file] },
		}),
	);
	await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Project opened"));
	expect((screen.getByLabelText("Reverse card order") as HTMLInputElement).checked).toBe(true);
	expect(view.container.querySelector(".dr-images span")?.textContent).toBe("100");
});
it("keeps manual moves and duplication usable while reversed and opens older projects in their original order", async () => {
	const view = await setup();
	fireEvent.click(screen.getByRole("button", { name: "Duplicate card" }));
	fireEvent.click(screen.getByRole("button", { name: "Duplicate card" }));
	fireEvent.click(screen.getByRole("button", { name: /Earlier/ }));
	const ids = () =>
		Array.from(view.container.querySelectorAll(".dr-images span")).map(
			(element) => element.textContent,
		);
	expect(ids()).toEqual(["1", "3", "2"]);
	fireEvent.click(screen.getByLabelText("Reverse card order"));
	expect(ids()).toEqual(["2", "3", "1"]);
	fireEvent.click(screen.getByRole("button", { name: /Earlier/ }));
	expect(ids()).toEqual(["3", "2", "1"]);
	fireEvent.click(screen.getByRole("button", { name: "Duplicate card" }));
	expect(ids()).toEqual(["3", "4", "2", "1"]);
	fireEvent.click(screen.getByRole("button", { name: "Remove card" }));
	expect(ids()).toEqual(["3", "2", "1"]);
	fireEvent.click(screen.getByLabelText("Reverse card order"));
	expect(ids()).toEqual(["1", "2", "3"]);
	const save = vi.fn(async (_recipe: string) => "C:/project.json");
	window.electronAPI.dataRecruitSaveProject = save;
	fireEvent.click(screen.getByRole("button", { name: "Save project" }));
	await waitFor(() => expect(save).toHaveBeenCalledOnce());
	const old = JSON.parse(save.mock.calls[0][0]);
	delete old.reverseOrder;
	old.order = [3, 1, 2];
	fireEvent.click(screen.getByLabelText("Reverse card order"));
	const file = new File([], "old.json");
	Object.defineProperty(file, "text", { value: async () => JSON.stringify(old) });
	await act(async () =>
		fireEvent.change(view.container.querySelector('input[accept=".json"]')!, {
			target: { files: [file] },
		}),
	);
	await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Project opened"));
	expect((screen.getByLabelText("Reverse card order") as HTMLInputElement).checked).toBe(false);
	expect(ids()).toEqual(["3", "1", "2"]);
});
