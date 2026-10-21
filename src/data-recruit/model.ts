export interface DataCard {
	id: number;
	fields: Record<string, string>;
}
export interface TemplateRow {
	key: string;
	label: string;
	color: string;
	valueColor: string;
}
export interface CardTemplate {
	id: string;
	name: string;
	titleColor: string;
	textColor: string;
	rows: TemplateRow[];
	font?: "Arial" | "Verdana" | "Georgia" | "Impact";
	textScale?: number;
	outline?: number;
	outlineColor?: string;
	spacing?: number;
	imageHeight?: number;
}
export const TEMPLATES: CardTemplate[] = [
	{
		id: "salary",
		name: "Salary per movie",
		titleColor: "#f39700",
		textColor: "#ffffff",
		rows: [
			{ key: "budget", label: "BUDGET", color: "#09a7ee", valueColor: "#fff000" },
			{ key: "box office", label: "BOX OFFICE", color: "#09a7ee", valueColor: "#fff000" },
			{ key: "paycheck", label: "PAYCHECK", color: "#08c900", valueColor: "#fff000" },
		],
	},
	{
		id: "facts",
		name: "Facts & comparisons",
		titleColor: "#23314d",
		textColor: "#ffffff",
		rows: [
			{ key: "category", label: "CATEGORY", color: "#334765", valueColor: "#ffffff" },
			{ key: "value", label: "VALUE", color: "#334765", valueColor: "#6ee7db" },
			{ key: "detail", label: "DETAIL", color: "#17665e", valueColor: "#ffffff" },
		],
	},
];
export const SAMPLE_TEXT = `1
Title: Crash
Year: 2004
Budget: $6.5M
Box Office: $98.4M
Paycheck: $1M

2
Title: Loverboy
Year: 2005
Budget: $6M
Box Office: $53.5K
Paycheck: $1M

3
Title: Miss Congeniality 2: Armed and Fabulous
Year: 2005
Budget: $45M
Box Office: $101.3M
Paycheck: $15M`;
export const FACTS_TEXT = `1
Title: First item
Category: Example
Value: 100
Detail: Add your facts

2
Title: Second item
Category: Example
Value: 200
Detail: Compare anything`;
export const normalizeKey = (value: string) =>
	value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

/** Explicit numbered blocks prevent accidental order-based image matching. */
export function parseCards(text: string): DataCard[] {
	const cards: DataCard[] = [];
	let current: DataCard | undefined;
	for (const [index, raw] of text
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.entries()) {
		const line = raw.trim();
		if (!line || line.startsWith("//")) continue;
		const number = line.match(/^(?:#\s*|\[)?(\d+)(?:\]|[.)])?\s*$/);
		if (number) {
			const id = Number(number[1]);
			if (id < 1 || !Number.isSafeInteger(id))
				throw new Error(`Line ${index + 1}: use a positive whole number.`);
			if (cards.some((card) => card.id === id)) throw new Error(`Entry ${id} appears twice.`);
			current = { id, fields: {} };
			cards.push(current);
			continue;
		}
		const separator = line.indexOf(":");
		if (!current || separator < 1)
			throw new Error(`Line ${index + 1}: use a numbered entry followed by Label: Value lines.`);
		const key = normalizeKey(line.slice(0, separator));
		if (key in current.fields) throw new Error(`Entry ${current.id}: ${key} appears twice.`);
		current.fields[key] = line.slice(separator + 1).trim();
	}
	if (!cards.length) throw new Error("Add at least one numbered entry.");
	return cards.sort((a, b) => a.id - b.id);
}
export function imageNumber(name: string): number | null {
	const match = name.match(/^\s*(\d+)(?=[\s._-]|$)/);
	return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}
export type OutputFormat = "landscape" | "shorts";
export interface ScrollSettings {
	format: OutputFormat;
	direction: "left" | "right";
	secondsPerCard: number;
	fit: "fill" | "fit";
}
export function geometry(format: OutputFormat) {
	return format === "shorts"
		? { width: 1080, height: 1920, cardWidth: 1080 }
		: { width: 1920, height: 1080, cardWidth: 640 };
}
export function scrollDuration(count: number, settings: ScrollSettings): number {
	const { width, cardWidth } = geometry(settings.format);
	const steps = Math.max(0, count - 1 + width / cardWidth - 1);
	return Math.max(settings.secondsPerCard, steps * settings.secondsPerCard + 2);
}
export function cardX(
	index: number,
	count: number,
	time: number,
	settings: ScrollSettings,
): number {
	const { width, cardWidth } = geometry(settings.format);
	const distance = Math.max(0, (count - 1) * cardWidth + width - cardWidth);
	const duration = scrollDuration(count, settings);
	let progress = Math.max(0, Math.min(1, (time - 1) / Math.max(1, duration - 2)));
	if (settings.direction === "right") progress = 1 - progress;
	return width - cardWidth + index * cardWidth - progress * distance;
}
export function validateCards(
	cards: DataCard[],
	template: CardTemplate,
	imageIds: number[],
): string[] {
	return cards.flatMap((card) => {
		const errors: string[] = [];
		if (!imageIds.includes(card.id)) errors.push(`Entry ${card.id}: image missing.`);
		for (const key of ["title", ...template.rows.map((row) => row.key)]) {
			if (!card.fields[key]?.trim()) errors.push(`Entry ${card.id}: ${key} is missing.`);
		}
		return errors;
	});
}
