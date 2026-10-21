export interface SnapResult {
	value: number;
	guide: number | null;
}
/** Snap either edge of a move; resizing passes a single candidate edge. */
export function snapTimelineEdge(
	value: number,
	targets: number[],
	threshold: number,
	duration = 0,
	min = 0,
	max = Infinity,
): SnapResult {
	let result = Math.max(min, Math.min(max, value));
	let guide: number | null = null;
	let best = threshold;
	if (!(threshold > 0)) return { value: result, guide };
	for (const target of targets) {
		if (!Number.isFinite(target)) continue;
		for (const offset of duration > 0 ? [0, duration] : [0]) {
			const candidate = target - offset;
			const distance = Math.abs(candidate - value);
			if (candidate >= min && candidate <= max && distance <= best) {
				best = distance;
				result = candidate;
				guide = target;
			}
		}
	}
	return { value: result, guide };
}
