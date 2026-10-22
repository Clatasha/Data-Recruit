import { useEffect, useLayoutEffect, useRef } from "react";

interface ClockOptions {
	position: number;
	playing: boolean;
	duration: number;
	paint: (time: number) => void;
	onPosition: (time: number) => void;
	onEnded: () => void;
}
/** Canvas follows the display clock; React's controls update at 10 Hz. */
export function usePreviewClock(options: ClockOptions) {
	const position = useRef(options.position),
		latest = useRef(options);
	useLayoutEffect(() => {
		latest.current = options;
		if (!options.playing) {
			position.current = options.position;
			options.paint(options.position);
		}
	}, [options]);
	useEffect(() => {
		if (!options.playing) return;
		const anchor = performance.now() - position.current * 1000;
		let frame = 0,
			lastUi = 0;
		const tick = (now: number) => {
			const value = Math.min(latest.current.duration, Math.max(0, (now - anchor) / 1000));
			position.current = value;
			latest.current.paint(value);
			if (now - lastUi >= 100 || value >= latest.current.duration) {
				latest.current.onPosition(value);
				lastUi = now;
			}
			if (value >= latest.current.duration) latest.current.onEnded();
			else frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [options.playing]);
	return position;
}
