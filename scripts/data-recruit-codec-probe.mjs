/** Probe the application's main world and tolerate an absent browser API. */
export function forceAvcFallback() {
	const Decoder = globalThis.VideoDecoder;
	const capabilities = {
		secureContext: globalThis.isSecureContext ?? null,
		videoDecoder: typeof Decoder,
		videoEncoder: typeof globalThis.VideoEncoder,
		forced: typeof Decoder?.isConfigSupported === "function",
	};
	if (capabilities.forced) {
		const supported = Decoder.isConfigSupported.bind(Decoder);
		Decoder.isConfigSupported = async (config) =>
			config.codec.startsWith("avc") ? { supported: false, config } : supported(config);
	}
	return capabilities;
}
