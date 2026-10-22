import { type SetStateAction, useRef, useState } from "react";

/** Snapshots retain imported media by reference without copying their bytes. */
export function useProjectHistory<T>(initial: T) {
	const [present, setPresent] = useState(initial);
	const past = useRef<T[]>([]),
		future = useRef<T[]>([]),
		latest = useRef(initial);
	const lastEdit = useRef(-Infinity),
		lastKey = useRef<keyof T | null>(null);
	function update<K extends keyof T>(key: K, action: SetStateAction<T[K]>) {
		const nextValue =
			typeof action === "function"
				? (action as (value: T[K]) => T[K])(latest.current[key])
				: action;
		if (Object.is(nextValue, latest.current[key])) return;
		const now = Date.now();
		if (now - lastEdit.current > 500 || (lastKey.current !== key && now - lastEdit.current > 25))
			past.current = [...past.current.slice(-29), latest.current];
		lastEdit.current = now;
		lastKey.current = key;
		future.current = [];
		latest.current = { ...latest.current, [key]: nextValue };
		setPresent(latest.current);
	}
	function move(undo: boolean) {
		const from = undo ? past : future,
			to = undo ? future : past;
		const next = from.current.at(-1);
		if (!next) return;
		from.current = from.current.slice(0, -1);
		to.current = [...to.current, latest.current];
		latest.current = next;
		lastEdit.current = -Infinity;
		setPresent(next);
	}
	return {
		reset: (next: T) => {
			past.current = [];
			future.current = [];
			latest.current = next;
			lastEdit.current = -Infinity;
			lastKey.current = null;
			setPresent(next);
			return next;
		},
		replace: (next: T) => {
			past.current = [...past.current.slice(-29), latest.current];
			future.current = [];
			latest.current = next;
			lastEdit.current = -Infinity;
			setPresent(next);
			return next;
		},
		checkpoint: () => {
			lastEdit.current = -Infinity;
		},
		present,
		update,
		undo: () => move(true),
		redo: () => move(false),
		canUndo: past.current.length > 0,
		canRedo: future.current.length > 0,
	};
}
