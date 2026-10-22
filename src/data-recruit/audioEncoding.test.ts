import { canEncodeAudio } from "mediabunny";
import { beforeEach, expect, it, vi } from "vitest";
import { selectAudioCodec } from "./audioEncoding";

vi.mock("mediabunny", () => ({ canEncodeAudio: vi.fn() }));
beforeEach(() => vi.mocked(canEncodeAudio).mockReset());
it("uses native AAC or Opus when the browser supplies an encoder", async () => {
	vi.mocked(canEncodeAudio).mockResolvedValueOnce(true);
	expect(await selectAudioCodec(true)).toBe("aac");
	vi.mocked(canEncodeAudio).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
	expect(await selectAudioCodec(false)).toBe("opus");
});
it("uses software PCM for desktop finishing when browser audio encoders are absent", async () => {
	vi.mocked(canEncodeAudio).mockResolvedValue(false);
	expect(await selectAudioCodec(true)).toBe("pcm-s16");
	await expect(selectAudioCodec(false)).rejects.toThrow("desktop app");
});
