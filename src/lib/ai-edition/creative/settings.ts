import { z } from "zod";

export const creativeSettingsSchema = z.object({
	flipHorizontal: z.boolean().default(false),
	flipVertical: z.boolean().default(false),
	reverse: z.boolean().default(false),
	overlay: z.enum(["none", "matrix", "dots", "particles"]).default("none"),
	opacity: z.number().min(0).max(1).default(0.2),
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.default("#67e8a5"),
	speed: z.number().min(0.25).max(3).default(1),
	density: z.number().min(0.1).max(1).default(0.5),
	size: z.number().min(0.5).max(3).default(1),
});
export type CreativeSettings = z.infer<typeof creativeSettingsSchema>;
export const DEFAULT_CREATIVE_SETTINGS = creativeSettingsSchema.parse({});
export const creativeSourceSchema = z.object({
	path: z.string().min(1),
	sourcePath: z.string().min(1),
	startSec: z.number().nonnegative(),
	endSec: z.number().nonnegative(),
	settings: creativeSettingsSchema,
});
export type CreativeSource = z.infer<typeof creativeSourceSchema>;
export function hasCreativeEffects(settings: CreativeSettings): boolean {
	return (
		settings.flipHorizontal ||
		settings.flipVertical ||
		settings.reverse ||
		settings.overlay !== "none"
	);
}
export function creativeClipPath(
	clip: { sourceStartSec: number; sourceEndSec?: number; creativeSource?: CreativeSource },
	originalPath: string,
): string {
	const copy = clip.creativeSource;
	return copy &&
		copy.sourcePath === originalPath &&
		clip.sourceStartSec >= copy.startSec - 0.001 &&
		(clip.sourceEndSec ?? Infinity) <= copy.endSec + 0.001
		? copy.path
		: originalPath;
}

/** A reverse derivative contains no baked live effects and survives slider changes. */
export function reusableReverseSource(
	copy: CreativeSource | null | undefined,
	path: string,
	start: number,
	end: number,
): copy is CreativeSource {
	return (
		!!copy &&
		copy.sourcePath === path &&
		copy.startSec <= start &&
		copy.endSec >= end &&
		copy.settings.reverse &&
		!copy.settings.flipHorizontal &&
		!copy.settings.flipVertical &&
		copy.settings.overlay === "none"
	);
}
