// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import type { AxcutClip } from "@/lib/ai-edition/schema";
import { EditClipModal } from "./Modals";

function renderWithI18n(ui: ReactElement) {
	return render(<I18nProvider>{ui}</I18nProvider>);
}

/** Issue #558's example: original 2:35, keep 0:20–1:45, final 1:25. */
const CLIP: AxcutClip = {
	id: "clip_1",
	assetId: "asset_1",
	sourceStartSec: 20,
	sourceEndSec: 105,
	timelineStartSec: 0,
	timelineEndSec: 85,
	wordRefs: [],
	origin: "user",
	reason: "",
};

const ASSET = { label: "rec", durationSec: 155 };

beforeAll(() => {
	// The trim-handle drag converts pointer delta against the track width into
	// seconds. jsdom reports 0, which would make every drag a no-op.
	Object.defineProperty(HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get() {
			return this.getAttribute?.("data-testid") === "edit-clip-trim-track" ? 1550 : 0;
		},
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderModal(clip: AxcutClip = CLIP) {
	return renderWithI18n(
		<EditClipModal
			open
			onClose={vi.fn()}
			clip={clip}
			assetMeta={ASSET}
			videoSources={[]}
			onApply={vi.fn()}
		/>,
	);
}

describe("EditClipModal trim duration readout (#558)", () => {
	it("shows original duration, trim range, and final duration for the selected range", () => {
		renderModal();

		expect(screen.getByTestId("edit-clip-original-duration")).toHaveTextContent("2:35.0");
		expect(screen.getByTestId("edit-clip-original-duration")).toHaveTextContent(
			"Original duration",
		);
		expect(screen.getByTestId("edit-clip-trim-range")).toHaveTextContent("0:20.0–1:45.0");
		expect(screen.getByTestId("edit-clip-trim-range")).toHaveTextContent("Trim range");
		expect(screen.getByTestId("edit-clip-final-duration")).toHaveTextContent("1:25.0");
		expect(screen.getByTestId("edit-clip-final-duration")).toHaveTextContent("Final duration");
	});

	it("updates the final duration as the start handle is dragged", () => {
		renderModal();

		fireEvent.pointerDown(screen.getByRole("button", { name: "Adjust clip start" }), {
			clientX: 0,
		});
		act(() => {
			window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 }));
		});

		expect(screen.getByTestId("edit-clip-original-duration")).toHaveTextContent("2:35.0");
		expect(screen.getByTestId("edit-clip-trim-range")).toHaveTextContent("0:30.0–1:45.0");
		expect(screen.getByTestId("edit-clip-final-duration")).toHaveTextContent("1:15.0");
	});

	it("will not pass the out-point off as the source length", () => {
		// `durationSec` is optional in the asset schema, so a document can reach
		// this dialog without one. The track still has to be drawn against
		// something that contains the selection (the out-point), but calling that
		// the original duration would claim a 2:35 source was 1:45 long.
		renderWithI18n(
			<EditClipModal
				open
				onClose={vi.fn()}
				clip={CLIP}
				assetMeta={{ label: "rec" }}
				videoSources={[]}
				onApply={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("edit-clip-original-duration")).toHaveTextContent("—");
		expect(screen.getByTestId("edit-clip-original-duration")).not.toHaveTextContent("1:45.0");
		// The kept range and its length are still known, and still shown.
		expect(screen.getByTestId("edit-clip-trim-range")).toHaveTextContent("0:20.0–1:45.0");
		expect(screen.getByTestId("edit-clip-final-duration")).toHaveTextContent("1:25.0");
	});

	it("states the kept range once, in the stats row", () => {
		renderModal();

		// The range used to be printed a second time inside the selection bar, 40px
		// under the stat that now carries it. One reading of a number is enough.
		expect(screen.getAllByText("0:20.0–1:45.0")).toHaveLength(1);
	});

	it("updates the final duration as the end handle is dragged", () => {
		renderModal();

		fireEvent.pointerDown(screen.getByRole("button", { name: "Adjust clip end" }), {
			clientX: 0,
		});
		act(() => {
			window.dispatchEvent(new MouseEvent("pointermove", { clientX: -50 }));
		});

		expect(screen.getByTestId("edit-clip-trim-range")).toHaveTextContent("0:20.0–1:40.0");
		expect(screen.getByTestId("edit-clip-final-duration")).toHaveTextContent("1:20.0");
	});
});

describe("EditClipModal in a short window (#1005)", () => {
	// The actions used to sit at the end of the scrolling body. In a window too short for the
	// card, Apply was clipped out of view, and a click where it should have been landed on the
	// backdrop, which closed the dialog and dropped the new trim and crop without a word.
	function renderWithSpies() {
		const onClose = vi.fn();
		const onApply = vi.fn();
		renderWithI18n(
			<EditClipModal
				open
				onClose={onClose}
				clip={CLIP}
				assetMeta={ASSET}
				videoSources={[]}
				onApply={onApply}
			/>,
		);
		return { onClose, onApply };
	}

	function clickBackdrop() {
		const backdrop = document.querySelector('[class*="modalBackdrop"]');
		if (!backdrop) throw new Error("no modal backdrop rendered");
		fireEvent.click(backdrop);
	}

	it("keeps the actions out of the scrolling body", () => {
		renderWithSpies();
		const apply = screen.getByRole("button", { name: "Apply" });

		expect(apply.closest('[class*="modalBody"]')).toBeNull();
		expect(apply.closest('[class*="modalFoot"]')).not.toBeNull();
	});

	it("closes on a backdrop click while there is nothing to lose", () => {
		const { onClose } = renderWithSpies();

		clickBackdrop();

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it.each([
		[
			"a trim",
			() => {
				fireEvent.pointerDown(screen.getByRole("button", { name: "Adjust clip start" }), {
					clientX: 0,
				});
				act(() => {
					window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 }));
					window.dispatchEvent(new MouseEvent("pointerup"));
				});
			},
		],
		["a crop", () => fireEvent.click(screen.getByRole("button", { name: "1:1" }))],
	])("keeps %s through a backdrop click, and drops it on Escape or Cancel", (_, edit) => {
		const { onClose, onApply } = renderWithSpies();
		edit();

		clickBackdrop();
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();

		// Those two say "discard"; a click beside the card does not.
		fireEvent.keyDown(document, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClose).toHaveBeenCalledTimes(2);
		expect(onApply).not.toHaveBeenCalled();
	});
});

describe("EditClipModal crop from the keyboard", () => {
	it("moves the crop with the arrows and resizes it with Shift + the arrows", () => {
		const onApply = vi.fn();
		renderWithI18n(
			<EditClipModal
				open
				onClose={vi.fn()}
				clip={CLIP}
				assetMeta={ASSET}
				videoSources={[]}
				onApply={onApply}
			/>,
		);
		// The editor shell seeks on the arrows from window: the crop must keep them.
		const seek = vi.fn();
		window.addEventListener("keydown", seek);
		try {
			const crop = screen.getByRole("slider", { name: "Crop" });
			fireEvent.keyDown(crop, { key: "ArrowLeft", shiftKey: true });
			fireEvent.keyDown(crop, { key: "ArrowRight" });
			expect(seek).not.toHaveBeenCalled();
		} finally {
			window.removeEventListener("keydown", seek);
		}
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledWith(
			20,
			105,
			expect.objectContaining({ x: 0.01, y: 0, width: 0.99 }),
		);
	});
});

it("applies a visual animation with the clip edit and omits text-only typewriter", () => {
	const onApply = vi.fn();
	renderWithI18n(
		<EditClipModal
			open
			onClose={vi.fn()}
			clip={CLIP}
			assetMeta={ASSET}
			videoSources={[]}
			onApply={onApply}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Fade" }));
	expect(screen.queryByRole("button", { name: "Typewriter" })).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Apply" }));
	expect(onApply).toHaveBeenCalledWith(20, 105, undefined, "fade");
});

describe("Edit Clip playable preview", () => {
	it("plays, scrubs and sets an in point without saving until Apply", async () => {
		const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
		const onApply = vi.fn();
		try {
			const { container } = renderWithI18n(
				<EditClipModal
					open
					onClose={vi.fn()}
					clip={CLIP}
					assetMeta={ASSET}
					videoSources={[{ id: "asset_1", src: "file:///take.mp4", label: "take" }]}
					onApply={onApply}
				/>,
			);
			const video = container.querySelector("video")!;
			fireEvent.loadedMetadata(video);
			expect(video.currentTime).toBe(20);
			fireEvent.click(screen.getByRole("button", { name: /^Play$/ }));
			expect(play).toHaveBeenCalled();
			fireEvent.change(screen.getByRole("slider", { name: "Scrub clip preview" }), {
				target: { value: "40" },
			});
			expect(video.currentTime).toBe(40);
			fireEvent.click(screen.getByRole("button", { name: "Set start here" }));
			expect(screen.getByTestId("edit-clip-trim-range")).toHaveTextContent("0:40.0–1:45.0");
			expect(onApply).not.toHaveBeenCalled();
			fireEvent.click(screen.getByRole("button", { name: "Apply" }));
			expect(onApply).toHaveBeenCalled();
		} finally {
			cleanup();
			pause.mockRestore();
			play.mockRestore();
		}
	});
});

describe("creative effects application", () => {
	it("saves mirroring instantly without preparing a source copy", async () => {
		const { DEFAULT_CREATIVE_SETTINGS } = await import("@/lib/ai-edition/creative/settings");
		const prepared = {
			path: "/copy.mp4",
			sourcePath: "/original.mp4",
			startSec: 20,
			endSec: 105,
			settings: { ...DEFAULT_CREATIVE_SETTINGS, flipHorizontal: true },
		};
		const previousApi = window.electronAPI;
		const prepareCreativeClip = vi.fn().mockResolvedValue(prepared);
		window.electronAPI = { ...previousApi, prepareCreativeClip };
		const apply = vi.fn(),
			close = vi.fn();
		try {
			renderWithI18n(
				<EditClipModal
					open
					clip={CLIP}
					assetMeta={ASSET}
					videoSources={[
						{
							id: CLIP.assetId,
							src: "file:///original.mp4",
							filePath: "/original.mp4",
							label: "Original",
						},
					]}
					onApply={apply}
					onClose={close}
				/>,
			);
			fireEvent.click(screen.getByLabelText("Mirror horizontally"));
			await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
			expect(prepareCreativeClip).not.toHaveBeenCalled();
			expect(apply).toHaveBeenCalledWith(20, 105, undefined, "none", null, prepared.settings);
			expect(close).toHaveBeenCalledOnce();
		} finally {
			window.electronAPI = previousApi;
		}
	});
	it("keeps the edit open if preparing the copy fails", async () => {
		const previousApi = window.electronAPI;
		window.electronAPI = {
			...previousApi,
			prepareCreativeClip: vi.fn().mockRejectedValue(new Error("Cannot decode source")),
		};
		const apply = vi.fn(),
			close = vi.fn();
		try {
			renderWithI18n(
				<EditClipModal
					open
					clip={CLIP}
					assetMeta={ASSET}
					videoSources={[
						{
							id: CLIP.assetId,
							src: "file:///original.mp4",
							filePath: "/original.mp4",
							label: "Original",
						},
					]}
					onApply={apply}
					onClose={close}
				/>,
			);
			fireEvent.click(screen.getByLabelText("Reverse source video"));
			await act(async () =>
				fireEvent.click(screen.getByRole("button", { name: "Prepare reverse preview" })),
			);
			expect(screen.getByRole("alert")).toHaveTextContent("Cannot decode source");
			expect(apply).not.toHaveBeenCalled();
			expect(close).not.toHaveBeenCalled();
		} finally {
			window.electronAPI = previousApi;
		}
	});
});

it("prepares reverse explicitly, then applies cached reverse and live settings without another encode", async () => {
	const { DEFAULT_CREATIVE_SETTINGS } = await import("@/lib/ai-edition/creative/settings");
	const prepared = {
		path: "/reverse.mp4",
		sourcePath: "/original.mp4",
		startSec: 20,
		endSec: 105,
		settings: { ...DEFAULT_CREATIVE_SETTINGS, reverse: true },
	};
	const previousApi = window.electronAPI;
	const prepareCreativeClip = vi.fn().mockResolvedValue(prepared),
		apply = vi.fn();
	window.electronAPI = { ...previousApi, prepareCreativeClip };
	try {
		renderWithI18n(
			<EditClipModal
				open
				clip={CLIP}
				assetMeta={ASSET}
				videoSources={[
					{
						id: CLIP.assetId,
						src: "file:///original.mp4",
						filePath: "/original.mp4",
						label: "Original",
					},
				]}
				onApply={apply}
				onClose={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByLabelText("Reverse source video"));
		expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
		expect(prepareCreativeClip).not.toHaveBeenCalled();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "Prepare reverse preview" })),
		);
		fireEvent.click(screen.getByLabelText("Mirror horizontally"));
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(prepareCreativeClip).toHaveBeenCalledTimes(1);
		expect(apply).toHaveBeenCalledWith(20, 105, undefined, "none", prepared, {
			...prepared.settings,
			flipHorizontal: true,
		});
	} finally {
		window.electronAPI = previousApi;
	}
});

it("shows reverse progress and cancels without applying the draft", async () => {
	const previousApi = window.electronAPI;
	let rejectPreparation: (reason: Error) => void = () => {
		/* Set by the preparation promise. */
	};
	const prepareCreativeClip = vi.fn(
		() =>
			new Promise<never>((_resolve, reject) => {
				rejectPreparation = reject;
			}),
	);
	const cancelCreativeClip = vi.fn(async () => {
		rejectPreparation(new Error("Preparation cancelled"));
	});
	window.electronAPI = {
		...previousApi,
		prepareCreativeClip,
		cancelCreativeClip,
		getCreativeClipProgress: vi.fn(async () => ({ state: "reversing" as const, progress: 45 })),
	};
	const apply = vi.fn();
	try {
		renderWithI18n(
			<EditClipModal
				open
				clip={CLIP}
				assetMeta={ASSET}
				videoSources={[
					{
						id: CLIP.assetId,
						src: "file:///original.mp4",
						filePath: "/original.mp4",
						label: "Original",
					},
				]}
				onApply={apply}
				onClose={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByLabelText("Reverse source video"));
		fireEvent.click(screen.getByRole("button", { name: "Prepare reverse preview" }));
		await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("value", "45"));
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
		expect(cancelCreativeClip).toHaveBeenCalledOnce();
		expect(apply).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toHaveTextContent("Preparation cancelled");
	} finally {
		window.electronAPI = previousApi;
	}
});
