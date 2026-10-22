import { ALL_FORMATS, BufferSource, Input, StreamSource } from "mediabunny";
/** Managed desktop media stays on disk and is read in bounded chunks. */
export async function openBookendInput(url: string) {
	if (!url.startsWith("data-recruit-media:"))
		return new Input({
			source: new BufferSource(await (await fetch(url)).arrayBuffer()),
			formats: ALL_FORMATS,
		});
	const id = url.slice("data-recruit-media:".length),
		api = window.electronAPI;
	if (!api?.dataRecruitBookendInfo || !api.dataRecruitReadBookend)
		throw new Error("Desktop bookend media is unavailable.");
	const info = await api.dataRecruitBookendInfo(id);
	const source = new StreamSource({
		getSize: () => info.size,
		maxCacheSize: 8 * 1024 * 1024,
		prefetchProfile: "fileSystem",
		read: async (start, end) => {
			const bytes = new Uint8Array(end - start);
			for (let at = start; at < end; at += 4 * 1024 * 1024) {
				const chunk = await api.dataRecruitReadBookend!(
					id,
					at,
					Math.min(end - at, 4 * 1024 * 1024),
				);
				if (!chunk.byteLength) throw new Error("Bookend video ended before the requested data.");
				bytes.set(new Uint8Array(chunk), at - start);
				if (chunk.byteLength !== Math.min(end - at, 4 * 1024 * 1024))
					throw new Error("Incomplete bookend read.");
			}
			return bytes;
		},
	});
	return new Input({ source, formats: ALL_FORMATS });
}
/** Resample only a decoded chunk's overlap with the chosen trim into 48 kHz stereo. */
export function copyAudioChunk(
	target: AudioBuffer,
	source: AudioBuffer,
	timestamp: number,
	trimStart: number,
) {
	const from = Math.max(0, Math.ceil((timestamp - trimStart) * target.sampleRate));
	const to = Math.min(
		target.length,
		Math.ceil((timestamp + source.duration - trimStart) * target.sampleRate),
	);
	for (let channel = 0; channel < target.numberOfChannels; channel++) {
		const input = source.getChannelData(Math.min(channel, source.numberOfChannels - 1)),
			output = target.getChannelData(channel);
		for (let at = from; at < to; at++) {
			const pos = (at / target.sampleRate + trimStart - timestamp) * source.sampleRate;
			const index = Math.max(0, Math.min(input.length - 1, Math.floor(pos))),
				next = Math.min(input.length - 1, index + 1);
			output[at] =
				input[index] + (input[next] - input[index]) * Math.max(0, Math.min(1, pos - index));
		}
	}
}
