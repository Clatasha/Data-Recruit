import vm from "node:vm";
import { expect, it } from "vitest";
import { forceAvcFallback } from "./data-recruit-codec-probe.mjs";

it("can run as a serialized main-world probe when VideoDecoder is absent", () => {
	const result = vm.runInNewContext(`(${forceAvcFallback.toString()})()`, {
		isSecureContext: false,
	});
	expect(result).toMatchObject({ videoDecoder: "undefined", forced: false, secureContext: false });
});
it("forces only AVC fallback and retains other codecs' original capability checks", async () => {
	const calls = [];
	class Decoder {
		static async isConfigSupported(config) {
			calls.push(config);
			return { supported: true, config };
		}
	}
	const result = vm.runInNewContext(`(${forceAvcFallback.toString()})()`, {
		VideoDecoder: Decoder,
		VideoEncoder: class {},
		isSecureContext: true,
	});
	expect(result).toMatchObject({ forced: true, secureContext: true });
	expect((await Decoder.isConfigSupported({ codec: "avc1.42001e" })).supported).toBe(false);
	expect((await Decoder.isConfigSupported({ codec: "vp09.00.10.08" })).supported).toBe(true);
	expect(calls).toEqual([{ codec: "vp09.00.10.08" }]);
});
