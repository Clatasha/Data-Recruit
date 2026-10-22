import type { ScrollSettings } from "./model";
export const TRANSITIONS = ["none", "fade", "scroll", "squeeze", "rise", "fall"] as const;
export type Transition = (typeof TRANSITIONS)[number];
export interface TransitionClip {
	duration: number;
	transition?: Transition;
	transitionSeconds?: number;
}
export function transitionDuration(clip: TransitionClip | null) {
	return !clip || !clip.transition || clip.transition === "none"
		? 0
		: Math.min(clip.duration, Math.max(0.1, clip.transitionSeconds ?? 0.75));
}
export function sequenceFrame(
	time: number,
	scroll: number,
	intro: TransitionClip | null,
	outro: TransitionClip | null,
) {
	const introDuration = intro?.duration ?? 0,
		lead = transitionDuration(intro);
	// Start moving behind the intro transition and continue from exactly that position.
	const offset = lead ? 1 + lead : 0;
	if (intro && time < introDuration) {
		const p = lead ? Math.max(0, Math.min(1, (time - introDuration + lead) / lead)) : 0;
		return {
			slot: "intro" as const,
			localTime: Math.max(0, time),
			progress: p,
			scrollTime: Math.max(0, time - introDuration + offset),
		};
	}
	if (outro && time >= introDuration + scroll) {
		const localTime = time - introDuration - scroll,
			duration = transitionDuration(outro);
		return {
			slot: "outro" as const,
			localTime,
			progress: duration ? Math.min(1, localTime / duration) : 1,
			scrollTime: scroll,
		};
	}
	return {
		slot: null,
		localTime: 0,
		progress: 0,
		scrollTime: Math.min(scroll, Math.max(0, time - introDuration + offset)),
	};
}
export function transitionTransform(
	style: Transition,
	progress: number,
	outgoing: boolean,
	width: number,
	height: number,
	direction: ScrollSettings["direction"],
) {
	const eased = progress * progress * (3 - 2 * progress),
		q = outgoing ? eased : 1 - eased;
	const result = { x: 0, y: 0, scaleX: 1, scaleY: 1, alpha: 1 };
	if (q === 0) return result;
	if (style === "fade") result.alpha = 1 - q;
	if (style === "scroll")
		result.x = (direction === "left" ? -1 : 1) * (outgoing ? 1 : -1) * q * width;
	if (style === "rise" || style === "fall")
		result.y = (style === "rise" ? -1 : 1) * (outgoing ? 1 : -1) * q * height;
	if (style === "squeeze") {
		result.scaleX = q < 0.45 ? 1 - 1.6 * q : 0.28 + (q - 0.45) * 4;
		result.scaleY = 1 + 0.2 * Math.sin(q * Math.PI);
		result.alpha = 1 - q;
	}
	return result;
}
export function transitionGain(clip: TransitionClip, localTime: number, slot: "intro" | "outro") {
	const duration = transitionDuration(clip);
	if (!duration) return 1;
	return Math.max(
		0,
		Math.min(1, slot === "intro" ? (clip.duration - localTime) / duration : localTime / duration),
	);
}
