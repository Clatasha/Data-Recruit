import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const DEFAULT_WORKSPACE = {
	snapping: true,
	showGuides: true,
	snapToPlayhead: true,
	snapToItems: true,
	snapToClips: true,
	showWaveforms: true,
};
export type WorkspacePreferences = typeof DEFAULT_WORKSPACE;
export type WorkspacePreference = keyof WorkspacePreferences;
interface WorkspaceState extends WorkspacePreferences {
	toggle: (key: WorkspacePreference) => void;
	reset: () => void;
}
export const useWorkspace = create<WorkspaceState>()(
	persist(
		(set) => ({
			...DEFAULT_WORKSPACE,
			toggle: (key) => set((state) => ({ [key]: !state[key] })),
			reset: () => set(DEFAULT_WORKSPACE),
		}),
		{
			name: "reaction-station.workspace",
			storage: createJSONStorage(() => localStorage),
			merge: (stored, current) => {
				const saved =
					stored && typeof stored === "object" ? (stored as Partial<WorkspacePreferences>) : {};
				return {
					...current,
					...Object.fromEntries(
						Object.keys(DEFAULT_WORKSPACE)
							.filter((key) => typeof saved[key as WorkspacePreference] === "boolean")
							.map((key) => [key, saved[key as WorkspacePreference]]),
					),
				};
			},
		},
	),
);
export function fitTimelineToWindow() {
	window.dispatchEvent(new Event("reaction-station-fit-timeline"));
}
