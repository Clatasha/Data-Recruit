import { cardX, geometry, type ScrollSettings, scrollDuration } from "./model";
export const TRANSITIONS = ["none", "fade", "scroll", "squeeze", "ease", "rise", "fall"] as const;
export const INTRO_TRANSITIONS = ["none", "fade", "scroll", "squeeze", "rise", "fall"] as const;
export const OUTRO_TRANSITIONS = ["none", "fade", "scroll", "ease"] as const;
export type Transition = (typeof TRANSITIONS)[number];
export interface TransitionClip {
	duration: number;
	transition?: Transition;
	transitionSeconds?: number;
}
export function outroTransition(style?: Transition): Transition {
	return style === "squeeze"
		? "none"
		: style === "rise" || style === "fall"
			? "ease"
			: (style ?? "none");
}
export function transitionDuration(clip: TransitionClip | null, settings?: ScrollSettings) {
	if (!clip || !clip.transition || clip.transition === "none") return 0;
	if (settings && (clip.transition === "scroll" || clip.transition === "squeeze")) {
		const { width, cardWidth } = geometry(settings.format);
		return (width / cardWidth) * settings.secondsPerCard;
	}
	return Math.max(0.1, clip.transitionSeconds ?? 0.75);
}
export function sequenceTiming(
	count: number,
	settings: ScrollSettings,
	intro: TransitionClip | null,
	outro: TransitionClip | null,
) {
	const { width, cardWidth } = geometry(settings.format);
	const speed = cardWidth / settings.secondsPerCard;
	const connected = intro?.transition === "scroll" || intro?.transition === "squeeze";
	const initialX = connected ? width : width - cardWidth;
	const motionStart = intro?.duration ?? 1;
	const introExit = transitionDuration(intro, settings);
	const outroStyle = outroTransition(outro?.transition);
	const outroEntry = transitionDuration(
		outro ? { ...outro, transition: outroStyle } : null,
		settings,
	);
	// The outro touches the last card. Its leading edge crosses the viewport
	// boundary here; a full viewport later it stops, exactly at full view.
	const outroStart = motionStart + Math.max(0, (initialX + count * cardWidth - width) / speed);
	const outroHold = outroStart + outroEntry;
	const cardsEnd = motionStart + (initialX + count * cardWidth) / speed;
	const total =
		!intro && !outro
			? scrollDuration(count, settings)
			: outro
				? Math.max(intro ? intro.duration + introExit : 0, outroHold + outro.duration)
				: Math.max(cardsEnd + 1, intro ? intro.duration + introExit : 0);
	return {
		width,
		cardWidth,
		speed,
		initialX,
		motionStart,
		introExit,
		outroStart,
		outroEntry,
		outroHold,
		total,
	};
}
export function sequenceFrame(
	time: number,
	count: number,
	settings: ScrollSettings,
	intro: TransitionClip | null,
	outro: TransitionClip | null,
) {
	const timing = sequenceTiming(count, settings, intro, outro);
	const motionTime = Math.max(
		0,
		Math.min(outro ? timing.outroHold : timing.total, time) - timing.motionStart,
	);
	const introVisible = Boolean(intro && time < intro.duration + timing.introExit);
	const outroVisible = Boolean(outro && time >= timing.outroStart);
	return {
		...timing,
		firstX:
			!intro && !outro
				? cardX(0, count, time, { ...settings, direction: "left" })
				: timing.initialX - timing.speed * motionTime,
		introVisible,
		outroVisible,
		introProgress:
			intro && timing.introExit
				? Math.max(0, Math.min(1, (time - intro.duration) / timing.introExit))
				: 0,
		outroProgress: timing.outroEntry
			? Math.max(0, Math.min(1, (time - timing.outroStart) / timing.outroEntry))
			: 1,
		introTime: Math.max(0, Math.min(time, intro?.duration ?? 0)),
		outroTime: Math.max(0, time - timing.outroHold),
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
	const eased = progress * progress * (3 - 2 * progress);
	const q = outgoing ? eased : 1 - eased;
	const result = { x: 0, y: 0, scaleX: 1, scaleY: 1, alpha: 1 };
	if (style === "fade") result.alpha = 1 - q;
	if (style === "scroll")
		result.x = (direction === "left" ? -1 : 1) * (outgoing ? progress : -(1 - progress)) * width;
	if (style === "ease" || style === "rise" || style === "fall")
		result.y = (style === "fall" ? 1 : -1) * (outgoing ? 1 : -1) * q * height;
	if (style === "squeeze") {
		result.scaleX = Math.max(0, 1 - progress);
		result.alpha = progress > 0.94 ? (1 - progress) / 0.06 : 1;
	}
	return result;
}
