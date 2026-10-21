import { create } from "zustand";

/** Transient preview readiness. Export never reads this state. */
export const usePreviewPlayback = create<{
	nativeStatus: "inactive" | "loading" | "ready" | "error";
	buffering: boolean;
}>(() => ({ nativeStatus: "inactive", buffering: false }));

export const PREVIEW_TRANSPORT_EVENT = "previewtransportchange";

interface PreviewTransport {
	requested: boolean;
	start(): void;
	stop(): void;
	check(): void;
	dispose(): void;
}
const transports = new WeakMap<HTMLMediaElement, PreviewTransport>();

export function previewPlaybackRequested(video: HTMLMediaElement): boolean {
	return Boolean(transports.get(video)?.requested) || !video.paused;
}

export function playPreview(video: HTMLMediaElement): void {
	const transport = transports.get(video);
	if (transport) transport.start();
	else void video.play().catch(() => undefined);
}

export function pausePreview(video: HTMLMediaElement): void {
	const transport = transports.get(video);
	if (transport) transport.stop();
	else video.pause();
}

/** Pause is an intent, even when buffering has already parked the media element. */
export function attachPreviewTransport(
	video: HTMLMediaElement,
	ready: () => boolean,
	pauseAudio: () => void,
	cancelResume: () => void,
	resumeAudio: () => void = () => {
		/* no separate audio */
	},
): PreviewTransport {
	let disposed = false;
	let internalPause = false;
	let pendingPlay: Promise<void> | null = null;
	let intent = 0;
	const signal = () => video.dispatchEvent(new Event(PREVIEW_TRANSPORT_EVENT));
	const park = () => {
		internalPause = true;
		video.pause();
		internalPause = false;
		pauseAudio();
	};
	// pause is delivered asynchronously in Chromium. Remember the internally generated
	// event separately; a real Pause command calls stop even if video.paused is already true.
	let internalPauseEvents = 0;
	const parkClock = () => {
		if (!video.paused) internalPauseEvents++;
		park();
	};
	const transport: PreviewTransport = {
		requested: !video.paused,
		start() {
			if (disposed) return;
			if (!this.requested) intent++;
			this.requested = true;
			signal();
			this.check();
		},
		stop() {
			intent++;
			this.requested = false;
			cancelResume();
			usePreviewPlayback.setState({ buffering: false });
			parkClock();
			signal();
		},
		check() {
			if (disposed || !this.requested) return;
			if (usePreviewPlayback.getState().nativeStatus === "error") {
				this.stop();
				return;
			}
			if (!ready()) {
				usePreviewPlayback.setState((state) => (state.buffering ? state : { buffering: true }));
				parkClock();
				return;
			}
			usePreviewPlayback.setState((state) => (state.buffering ? { buffering: false } : state));
			if (!video.paused || pendingPlay) return;
			const play = video.play();
			if (!video.paused) resumeAudio();
			const playIntent = intent;
			pendingPlay = play;
			void play
				.catch(() => {
					if (!disposed && intent === playIntent && !usePreviewPlayback.getState().buffering)
						this.stop();
				})
				.finally(() => {
					if (pendingPlay === play) pendingPlay = null;
					if (disposed) video.pause();
					else if (!this.requested) parkClock();
				});
		},
		dispose() {
			disposed = true;
			video.removeEventListener("play", onPlay);
			video.removeEventListener("pause", onPause);
			transports.delete(video);
			this.requested = false;
			park();
			usePreviewPlayback.setState({ buffering: false });
		},
	};
	const onPlay = () => {
		if (!video.paused) transport.start();
	};
	const onPause = () => {
		if (internalPause || internalPauseEvents > 0) {
			internalPauseEvents = Math.max(0, internalPauseEvents - 1);
			return;
		}
		transport.stop();
	};
	transports.set(video, transport);
	video.addEventListener("play", onPlay);
	video.addEventListener("pause", onPause);
	return transport;
}
