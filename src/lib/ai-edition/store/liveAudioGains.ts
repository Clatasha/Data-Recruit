import { create } from "zustand";
import { trackGroupId } from "../document/audioTracks";
import type { AxcutAudioTrack } from "../schema";

/** Playback-only slider values. The document receives one undoable edit on release. */
export const useLiveAudioGains = create<{
	gains: Record<string, number>;
	setGain: (id: string, gain: number) => void;
	clearGain: (id: string, expected?: number) => void;
}>((set) => ({
	gains: {},
	setGain: (id, gain) => {
		if (!Number.isFinite(gain)) return;
		set((state) => ({ gains: { ...state.gains, [id]: Math.max(-60, Math.min(12, gain)) } }));
	},
	clearGain: (id, expected) =>
		set((state) => {
			if (expected !== undefined && state.gains[id] !== expected) return state;
			const gains = { ...state.gains };
			delete gains[id];
			return { gains };
		}),
}));

export function previewTrackGainDb(track: AxcutAudioTrack): number {
	return useLiveAudioGains.getState().gains[trackGroupId(track)] ?? track.gainDb;
}
