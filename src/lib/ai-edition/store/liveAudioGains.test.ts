import { afterEach, expect, it } from "vitest";
import { createAudioTrack } from "../schema";
import { previewTrackGainDb, useLiveAudioGains } from "./liveAudioGains";

afterEach(() => useLiveAudioGains.setState({ gains: {} }));
it("feeds live gain to all fragments and keeps a newer drag when an earlier save finishes", () => {
	const track = { ...createAudioTrack({ assetId: "sound", durationSec: 10 }), trackId: "group" };
	useLiveAudioGains.getState().setGain("group", -6);
	expect(previewTrackGainDb(track)).toBe(-6);
	expect(previewTrackGainDb({ ...track, id: "fragment" })).toBe(-6);
	useLiveAudioGains.getState().setGain("group", -12);
	useLiveAudioGains.getState().clearGain("group", -6);
	expect(previewTrackGainDb(track)).toBe(-12);
	useLiveAudioGains.getState().clearGain("group", -12);
	expect(previewTrackGainDb(track)).toBe(track.gainDb);
});
