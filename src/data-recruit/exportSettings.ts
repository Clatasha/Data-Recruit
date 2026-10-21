import type { OutputFormat } from "./model";
export interface ExportSettings {
	resolution: 720 | 1080 | 1440;
	fps: 24 | 30 | 60;
	quality: "standard" | "high";
}
export const DEFAULT_EXPORT: ExportSettings = { resolution: 1080, fps: 30, quality: "high" };
export function exportGeometry(format: OutputFormat, options: ExportSettings) {
	const short = options.resolution,
		long = Math.round((short * 16) / 9 / 2) * 2;
	return {
		width: format === "shorts" ? short : long,
		height: format === "shorts" ? long : short,
		bitrate: Math.round(
			8_000_000 * (short / 1080) ** 2 * (options.fps / 30) * (options.quality === "high" ? 1 : 0.6),
		),
	};
}
