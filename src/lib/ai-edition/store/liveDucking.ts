import { create } from "zustand";
export const useLiveDucking = create<{
	reductions: Record<string, number>;
	set: (id: string, value: number) => void;
	clear: (id: string, expected?: number) => void;
}>((set) => ({
	reductions: {},
	set: (id, value) => set((s) => ({ reductions: { ...s.reductions, [id]: value } })),
	clear: (id, expected) =>
		set((s) => {
			if (expected !== undefined && s.reductions[id] !== expected) return s;
			const reductions = { ...s.reductions };
			delete reductions[id];
			return { reductions };
		}),
}));
