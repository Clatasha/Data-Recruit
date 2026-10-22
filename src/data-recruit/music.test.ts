import { describe, expect, it } from "vitest";
import { badgeNumber, DEFAULT_BADGE } from "./model";
import {
	type MusicClip,
	mixMusic,
	musicGain,
	musicPosition,
	musicSchema,
	serializeMusic,
	splitMusic,
	waveform,
} from "./music";

function buffer(values: number[], rate = 4) {
	const channels = [Float32Array.from(values), Float32Array.from(values)];
	return {
		getChannelData: (channel: number) => channels[channel],
		numberOfChannels: 2,
		sampleRate: rate,
		length: values.length,
		duration: values.length / rate,
	} as AudioBuffer;
}
function clip(patch: Partial<MusicClip> = {}): MusicClip {
	return {
		id: "music",
		name: "song.wav",
		url: "data:audio/wav;base64,AA==",
		at: 1,
		start: 0.5,
		end: 2,
		duration: 1.5,
		loop: false,
		loopOffset: 0,
		volume: 0.5,
		muted: false,
		fadeIn: 0,
		fadeOut: 0,
		buffer: buffer([0, 0, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]),
		peaks: [],
		...patch,
	};
}
describe("music mix and persistence", () => {
	it("adds overlapping tracks to bookend audio at their timeline offsets without changing the existing mix", () => {
		const target = buffer(Array(12).fill(0.1));
		mixMusic(target, 0, [clip(), clip({ id: "second", volume: 0.25 })]);
		expect(Array.from(target.getChannelData(0)).slice(0, 4)).toEqual(
			Array(4).fill(Math.fround(0.1)),
		);
		for (const value of target.getChannelData(0).slice(4, 10)) expect(value).toBeCloseTo(0.7);
		expect(target.getChannelData(0)[10]).toBeCloseTo(0.1);
	});
	it("uses the trimmed loop range, handles sub-second chunk boundaries and applies mute, volume and fades", () => {
		const song = clip({ start: 0.5, end: 1.5, loop: true, duration: 4, fadeIn: 1, fadeOut: 1 });
		expect(musicPosition(song, 1.25)).toBe(0.75);
		expect(musicPosition(song, 4)).toBeNull();
		expect(musicGain(song, 0.5)).toBeCloseTo(0.25);
		expect(musicGain(song, 3.5)).toBeCloseTo(0.25);
		const target = buffer(Array(4).fill(0));
		mixMusic(target, 1.5, [song, clip({ muted: true, volume: 1 })]);
		expect(target.getChannelData(0)[0]).toBeCloseTo(0.2);
		expect(target.getChannelData(0)[2]).toBeCloseTo(0.4);
	});
	it("splits a loop without resetting its phase, including after serializing and reopening", () => {
		const original = clip({ loop: true, duration: 6, end: 1.5 });
		const pieces = splitMusic(original, 3.25)!;
		expect(pieces[0].duration).toBe(2.25);
		expect(pieces[1].at).toBe(3.25);
		const restored = { ...pieces[1], ...musicSchema.parse(serializeMusic(pieces[1])) };
		for (const local of [0, 0.25, 0.8, 1.5])
			expect(musicPosition(restored, local)).toBeCloseTo(musicPosition(original, local + 2.25)!);
		expect(serializeMusic(restored)).not.toHaveProperty("buffer");
		expect(serializeMusic(restored)).not.toHaveProperty("peaks");
		expect(splitMusic(original, original.at)).toBeNull();
	});
	it("splits unlooped source trims without losing source alignment", () => {
		const pieces = splitMusic(clip(), 1.75)!;
		expect(pieces[1].start).toBe(1.25);
		expect(pieces[1].duration).toBe(0.75);
	});
	it("extracts a compact waveform and rejects unrelated paths in saved audio", () => {
		expect(waveform(buffer([0, 0.9, 0, 0]))).toHaveLength(160);
		expect(
			musicSchema.safeParse({ ...serializeMusic(clip()), url: "file:///private/file.wav" }).success,
		).toBe(false);
	});
});
it("numbers displayed card positions independently from their image IDs in both directions", () => {
	expect(
		[0, 1, 2].map((index) => badgeNumber({ ...DEFAULT_BADGE, direction: "down" }, index, 3)),
	).toEqual([3, 2, 1]);
	expect(badgeNumber(DEFAULT_BADGE, 2, 10)).toBe(3);
	expect(badgeNumber({ ...DEFAULT_BADGE, direction: "down", start: 20 }, 2, 10)).toBe(18);
});
