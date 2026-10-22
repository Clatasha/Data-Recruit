import { canEncodeAudio } from "mediabunny";
/** Electron builds can lack AudioEncoder entirely; PCM uses Mediabunny's software encoder. */
export async function selectAudioCodec(
	nativeAvailable: boolean,
): Promise<"aac" | "opus" | "pcm-s16"> {
	const options = { numberOfChannels: 2, sampleRate: 48_000, bitrate: 192_000 };
	if (await canEncodeAudio("aac", options)) return "aac";
	if (await canEncodeAudio("opus", options)) return "opus";
	if (nativeAvailable) return "pcm-s16";
	throw new Error(
		"No audio encoder is available. Use the Data Recruit desktop app to export this video with sound.",
	);
}
