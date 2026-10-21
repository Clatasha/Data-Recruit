import { describe, expect, it } from "vitest";
import {
	cardX,
	imageNumber,
	parseCards,
	type ScrollSettings,
	scrollDuration,
	TEMPLATES,
	validateCards,
} from "./model";

const settings: ScrollSettings = {
	format: "landscape",
	direction: "left",
	secondsPerCard: 4,
	fit: "fill",
};
describe("numbered data import", () => {
	it("matches labels independently of line order and preserves colons in titles", () => {
		const cards = parseCards(
			"\uFEFF2\r\nPaycheck: $2M\r\nTitle: Movie: Part Two\r\nBox_Office: $5M\r\nBudget: $1M\n\n1.\nTitle: First",
		);
		expect(cards.map((card) => card.id)).toEqual([1, 2]);
		expect(cards[1].fields).toEqual({
			title: "Movie: Part Two",
			paycheck: "$2M",
			"box office": "$5M",
			budget: "$1M",
		});
	});
	it("rejects ambiguous entries and fields instead of overwriting data", () => {
		expect(() => parseCards("1\nTitle: A\n1\nTitle: B")).toThrow("twice");
		expect(() => parseCards("1\nTitle: A\nTITLE: B")).toThrow("twice");
		expect(() => parseCards("Title: A")).toThrow("numbered");
		expect(() => parseCards("0\nTitle: A")).toThrow("positive");
	});
	it("extracts image ids from numbered filenames without matching unrelated names", () => {
		expect(imageNumber("01 - Crash.jpg")).toBe(1);
		expect(imageNumber("2.png")).toBe(2);
		expect(imageNumber("Crash 1.jpg")).toBeNull();
		expect(imageNumber("1abc.jpg")).toBeNull();
	});
	it("reports missing data and missing images per numbered card", () => {
		expect(validateCards(parseCards("1\nTitle: Crash\nPaycheck: $1M"), TEMPLATES[0], [])).toEqual([
			"Entry 1: image missing.",
			"Entry 1: budget is missing.",
			"Entry 1: box office is missing.",
		]);
	});
	it("takes field requirements from the selected template", () => {
		expect(
			validateCards(parseCards("1\nTitle: A\nCategory: B\nValue: C\nDetail: D"), TEMPLATES[1], [1]),
		).toEqual([]);
	});
});
describe("scroll geometry", () => {
	it("starts with the first card fully visible and finishes with the last fully visible", () => {
		expect(cardX(0, 10, 0, settings)).toBe(1280);
		expect(cardX(9, 10, scrollDuration(10, settings), settings)).toBe(0);
	});
	it("reverses movement and adapts to portrait", () => {
		expect(cardX(9, 10, 0, { ...settings, direction: "right" })).toBe(0);
		const portrait = { ...settings, format: "shorts" as const };
		expect(cardX(0, 3, 0, portrait)).toBe(0);
		expect(cardX(2, 3, scrollDuration(3, portrait), portrait)).toBe(0);
		expect(scrollDuration(1, portrait)).toBe(4);
	});
});
