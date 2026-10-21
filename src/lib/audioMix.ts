/**
 * Mic gain applied when mixing the microphone with system audio into the recorder's
 * destination stream. Boosted slightly above unity so the voice is clearly audible
 * over typical system-audio levels.
 */
export const MIC_GAIN_BOOST = 1.4;

/**
 * The mic gain the native capture helpers should receive: boosted above unity
 * only when the mic has to sit over system audio, at unity on its own so a mic
 * that already runs hot does not get +2.9 dB it cannot spend — the native
 * mixers hard-clamp at full scale. This is the same rule mixAudioTracks applies
 * from track presence, expressed from the system-audio toggle the native
 * request builders know.
 */
export function nativeMicrophoneGain(systemAudioEnabled: boolean): number {
	return systemAudioEnabled ? MIC_GAIN_BOOST : 1;
}

/**
 * Duration of the mic fade-in applied at the start of a recording. Masks the
 * click/pop that the mic produces at its first packet (echo-canceller warm-up,
 * DC offset, gain-stage step) without audibly muting speech.
 */
export const MIC_FADE_IN_S = 0.02;

export type MixAudioTracksInput = {
	controllable?: boolean;
	initialLevels?: { microphone: number; system: number };
	systemAudioTrack?: MediaStreamTrack | null | undefined;
	micAudioTrack?: MediaStreamTrack | null | undefined;
};

export type MixAudioTracksResult = {
	/** AudioContext created to mix the two tracks. `null` when no mixing was needed. */
	context: AudioContext | null;
	setLevels?: (microphone: number, system: number) => void;
	/** The track to add to the recorder's MediaStream, or `null` when neither input was given. */
	track: MediaStreamTrack | null;
};

/**
 * Combine system audio and the microphone into a single audio track for the recorder.
 *
 * Whenever a mic track is present it is routed through an AudioContext + GainNode with
 * a short fade-in so its first packet doesn't click — mic-only recordings (a common
 * mode) get the same anti-click treatment as mixed ones, so `context` is non-null
 * whenever a mic track is present. The mic is boosted above unity only when it has to
 * sit over system audio; on its own it rides at unity so mic-only loudness is unchanged.
 * Caller owns the returned `context` and must `.close()` it on teardown.
 *
 * - System audio only: returned verbatim, no AudioContext created (no warm-up click).
 * - Neither present: returns `{ context: null, track: null }`.
 */
export function mixAudioTracks({
	systemAudioTrack,
	micAudioTrack,
	controllable = false,
	initialLevels = { microphone: 1, system: 1 },
}: MixAudioTracksInput): MixAudioTracksResult {
	if (!micAudioTrack && (!controllable || !systemAudioTrack)) {
		return { context: null, track: systemAudioTrack ?? null };
	}

	const context = new AudioContext();
	const destination = context.createMediaStreamDestination();
	let systemGain: GainNode | undefined;
	let micGain: GainNode | undefined;
	if (systemAudioTrack) {
		const systemSource = context.createMediaStreamSource(new MediaStream([systemAudioTrack]));
		if (controllable) {
			systemGain = context.createGain();
			systemGain.gain.setValueAtTime(initialLevels.system, context.currentTime);
			systemSource.connect(systemGain).connect(destination);
		} else systemSource.connect(destination);
	}
	// Unity when the mic is on its own; boosted only when competing with system audio.
	const micTargetGain = nativeMicrophoneGain(Boolean(systemAudioTrack));
	if (micAudioTrack) {
		const micSource = context.createMediaStreamSource(new MediaStream([micAudioTrack]));
		micGain = context.createGain();
		micGain.gain.setValueAtTime(0, context.currentTime);
		micGain.gain.linearRampToValueAtTime(
			micTargetGain * initialLevels.microphone,
			context.currentTime + MIC_FADE_IN_S,
		);
		micSource.connect(micGain).connect(destination);
	}
	return {
		context,
		track: destination.stream.getAudioTracks()[0],
		setLevels: (microphone, system) => {
			for (const [node, level] of [
				[micGain, microphone * micTargetGain],
				[systemGain, system],
			] as const) {
				if (!node) continue;
				node.gain.cancelScheduledValues(context.currentTime);
				node.gain.setTargetAtTime(level, context.currentTime, 0.015);
			}
		},
	};
}
