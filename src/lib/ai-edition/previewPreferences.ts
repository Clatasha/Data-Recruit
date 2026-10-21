import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ProxyStatus } from "../../../electron/media/previewProxy";
export type PreviewQuality = "auto" | "full" | "half" | "quarter";
export const usePreviewPreferences = create<{
	quality: PreviewQuality;
	proxies: boolean;
	setQuality: (quality: PreviewQuality) => void;
	setProxies: (enabled: boolean) => void;
}>()(
	persist(
		(set) => ({
			quality: "auto",
			proxies: false,
			setQuality: (quality) => set({ quality }),
			setProxies: (proxies) => set({ proxies }),
		}),
		{
			name: "reaction-station.preview",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ quality, proxies }) => ({ quality, proxies }),
			merge: (stored, current) => {
				const value = stored as { quality?: unknown; proxies?: unknown } | null;
				return {
					...current,
					quality: ["auto", "full", "half", "quarter"].includes(String(value?.quality))
						? (value?.quality as PreviewQuality)
						: "auto",
					proxies: value?.proxies === true,
				};
			},
		},
	),
);
export const usePreviewProxies = create<{
	jobs: Record<string, ProxyStatus>;
	paths: Record<string, string>;
	cancelled: boolean;
	retry: () => void;
}>((set) => ({
	jobs: {},
	paths: {},
	cancelled: false,
	retry: () => set({ jobs: {}, cancelled: false }),
}));
export function previewResolution(
	width: number,
	height: number,
	dpr: number,
	quality: PreviewQuality,
) {
	const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
	const scale =
		quality === "half"
			? 0.5
			: quality === "quarter"
				? 0.25
				: quality === "auto"
					? Math.min(1, 1280 / Math.max(1, width * ratio), 720 / Math.max(1, height * ratio))
					: 1;
	return {
		width: Math.max(2, Math.round(width * ratio * scale)),
		height: Math.max(2, Math.round(height * ratio * scale)),
	};
}
