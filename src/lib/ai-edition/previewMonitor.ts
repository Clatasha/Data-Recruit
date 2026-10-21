import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Monitoring only: never stored in the project or used by export. */
export const usePreviewMonitor = create<{
	volume: number;
	muted: boolean;
	recordingMuted: boolean;
	setVolume: (volume: number) => void;
	setMuted: (muted: boolean) => void;
}>()(
	persist(
		(set) => ({
			volume: 1,
			muted: false,
			recordingMuted: false,
			setVolume: (value) =>
				set({ volume: Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1 }),
			setMuted: (muted) => set({ muted }),
		}),
		{
			name: "reaction-station.monitor",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ volume, muted }) => ({ volume, muted }),
			merge: (stored, current) => {
				const value = stored as { volume?: unknown; muted?: unknown } | null;
				return {
					...current,
					volume:
						typeof value?.volume === "number" && Number.isFinite(value.volume)
							? Math.max(0, Math.min(1, value.volume))
							: 1,
					muted: value?.muted === true,
				};
			},
		},
	),
);
export function monitorGainDb(): number {
	const { volume, muted, recordingMuted } = usePreviewMonitor.getState();
	return muted || recordingMuted || volume === 0 ? -Infinity : 20 * Math.log10(volume);
}
