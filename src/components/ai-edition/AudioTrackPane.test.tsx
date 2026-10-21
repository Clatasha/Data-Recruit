// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: (scope: string) => (key: string) => `${scope}.${key}`,
}));

import { DEFAULT_DUCKING_TRIGGER } from "@/lib/ai-edition/ducking";
import { previewTrackGainDb, useLiveAudioGains } from "@/lib/ai-edition/store/liveAudioGains";
import { useLiveDucking } from "@/lib/ai-edition/store/liveDucking";
import { AudioTrackPane } from "./RightPanes";

afterEach(() => {
	cleanup();
	useLiveAudioGains.setState({ gains: {} });
});

describe("AudioTrackPane", () => {
	const createTl = () => ({
		selectedAudioTrackId: "track_1",
		audioTracks: [
			{
				id: "track_1",
				clipId: "clip_1",
				assetId: "asset_audio_1",
				startSec: 0,
				durationSec: 5,
				gainDb: 0,
				fadeInMs: 0,
				fadeOutMs: 0,
				offsetSec: 0,
			},
		],
		assets: [
			{
				id: "asset_audio_1",
				kind: "audio" as const,
				label: "voice.mp3",
				originalPath: "/path/voice.mp3",
				durationSec: 5,
			},
		],
		clearSelection: vi.fn(),
		selectAudioTrack: vi.fn(),
		setAudioTrackGain: vi.fn(),
		setAudioTrackFade: vi.fn(),
		removeAudioTrack: vi.fn(),
	});

	it("lets a microphone lower all other audio by a live percentage with one saved edit", async () => {
		const tl = createTl();
		const updateAudioTrack = vi.fn(async () => undefined);
		const microphone = {
			...tl.audioTracks[0],
			kind: "voiceover",
			recordingSource: "microphone",
			duckingTrigger: DEFAULT_DUCKING_TRIGGER,
		};
		const view = render(
			<AudioTrackPane tl={{ ...tl, audioTracks: [microphone], updateAudioTrack } as never} />,
		);
		fireEvent.click(screen.getByLabelText("settings.ducking.triggerEnabled"));
		expect(updateAudioTrack).toHaveBeenCalledWith("track_1", {
			duckingTrigger: { ...DEFAULT_DUCKING_TRIGGER, enabled: true },
		});
		view.rerender(
			<AudioTrackPane
				tl={
					{
						...tl,
						audioTracks: [
							{ ...microphone, duckingTrigger: { ...DEFAULT_DUCKING_TRIGGER, enabled: true } },
						],
						updateAudioTrack,
					} as never
				}
			/>,
		);
		updateAudioTrack.mockClear();
		const slider = screen.getByRole("slider", { name: "settings.ducking.reductionPercent" });
		fireEvent.change(slider, { target: { value: "50" } });
		expect(useLiveDucking.getState().reductions.track_1).toBe(50);
		expect(updateAudioTrack).not.toHaveBeenCalled();
		fireEvent.mouseUp(slider);
		await waitFor(() =>
			expect(updateAudioTrack).toHaveBeenCalledWith("track_1", {
				duckingTrigger: { ...DEFAULT_DUCKING_TRIGGER, enabled: true, reductionPercent: 50 },
			}),
		);
		expect(updateAudioTrack).toHaveBeenCalledTimes(1);
	});

	it("renders close button and closes audio track by default", () => {
		const tl = createTl();
		render(<AudioTrackPane tl={tl as never} />);

		const closeBtn = screen.getByRole("button", { name: "common.actions.close" });
		expect(closeBtn).toBeInTheDocument();
		const header = closeBtn.closest("header");
		expect(header).toHaveStyle({ paddingRight: "var(--sp-4)" });
		const svg = closeBtn.querySelector("svg");
		expect(svg?.classList.contains("lucide-x")).toBe(true);

		fireEvent.click(closeBtn);
		expect(tl.clearSelection).toHaveBeenCalledTimes(1);
	});

	it("calls custom onClose if provided", () => {
		const tl = createTl();
		const onClose = vi.fn();
		render(<AudioTrackPane tl={tl as never} onClose={onClose} />);

		const closeBtn = screen.getByRole("button", { name: "common.actions.close" });
		fireEvent.click(closeBtn);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(tl.selectAudioTrack).not.toHaveBeenCalled();
	});
	it("previews level changes while dragging and writes one edit on release", async () => {
		const tl = createTl();
		const view = render(<AudioTrackPane tl={tl as never} />);
		const slider = screen.getByRole("slider", { name: "settings.audio.outputGain" });
		fireEvent.change(slider, { target: { value: "-12" } });
		expect(previewTrackGainDb(tl.audioTracks[0] as never)).toBe(-12);
		expect(tl.audioTracks[0].gainDb).toBe(0);
		expect(tl.setAudioTrackGain).not.toHaveBeenCalled();
		fireEvent.mouseUp(slider);
		await waitFor(() => expect(tl.setAudioTrackGain).toHaveBeenCalledWith("track_1", -12));
		expect(tl.setAudioTrackGain).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(useLiveAudioGains.getState().gains.track_1).toBeUndefined());
		fireEvent.change(slider, { target: { value: "-6" } });
		view.unmount();
		expect(useLiveAudioGains.getState().gains.track_1).toBeUndefined();
	});
});
