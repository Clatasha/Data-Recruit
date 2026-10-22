import { type CardTemplate, cardX, type DataCard, geometry, type ScrollSettings } from "./model";

export interface CardImage {
	id: number;
	name: string;
	url: string;
	x: number;
	y: number;
	image: HTMLImageElement;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/)) {
		const next = line ? `${line} ${word}` : word;
		if (ctx.measureText(next).width > width && line) {
			lines.push(line);
			line = word;
		} else line = next;
	}
	if (line) lines.push(line);
	return lines;
}
function textBox(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	width: number,
	height: number,
	maxSize: number,
	color: string,
	maxLines = 1,
	style?: CardTemplate,
) {
	let size = maxSize * (style?.textScale ?? 1);
	let lines: string[] = [];
	while (size >= 10) {
		ctx.font = `900 ${size}px ${style?.font ?? "Arial"}, sans-serif`;
		lines = wrap(ctx, text, width);
		if (
			lines.length <= maxLines &&
			lines.length * size * 1.15 <= height &&
			lines.every((line) => ctx.measureText(line).width <= width)
		)
			break;
		size -= 1;
	}
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, width, height);
	ctx.clip();
	lines = lines.slice(0, maxLines);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";
	ctx.lineWidth = size * (style?.outline ?? 0.065);
	ctx.strokeStyle = style?.outlineColor ?? "#131722";
	ctx.fillStyle = color;
	lines.forEach((line, index) => {
		const yy = y + height / 2 + (index - (lines.length - 1) / 2) * size * 1.15;
		if (ctx.lineWidth > 0 && (style?.outline ?? 0.065) > 0)
			ctx.strokeText(line, x + width / 2, yy, width);
		ctx.fillText(line, x + width / 2, yy, width);
	});
	ctx.restore();
}
export function drawImageFit(
	ctx: CanvasRenderingContext2D,
	image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas,
	x: number,
	y: number,
	width: number,
	height: number,
	fit: "fill" | "fit",
	focusX = 0.5,
	focusY = 0.5,
) {
	const sourceWidth =
		"videoWidth" in image
			? image.videoWidth
			: "naturalWidth" in image
				? image.naturalWidth
				: image.width;
	const sourceHeight =
		"videoHeight" in image
			? image.videoHeight
			: "naturalHeight" in image
				? image.naturalHeight
				: image.height;
	if (!sourceWidth || !sourceHeight) return;
	const scale =
		fit === "fill"
			? Math.max(width / sourceWidth, height / sourceHeight)
			: Math.min(width / sourceWidth, height / sourceHeight);
	const w = sourceWidth * scale,
		h = sourceHeight * scale;
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, width, height);
	ctx.clip();
	ctx.fillStyle = "#111827";
	ctx.fillRect(x, y, width, height);
	ctx.drawImage(image, x + (width - w) * focusX, y + (height - h) * focusY, w, h);
	ctx.restore();
}
export function renderCard(
	card: DataCard,
	image: CardImage | undefined,
	template: CardTemplate,
	settings: ScrollSettings,
): HTMLCanvasElement {
	const { cardWidth, height } = geometry(settings.format);
	const canvas = document.createElement("canvas");
	canvas.width = cardWidth;
	canvas.height = height;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Canvas unavailable");
	const gap = Math.round(cardWidth * (template.spacing ?? 0.028));
	const width = cardWidth - gap;
	const imageHeight = Math.round(height * (template.imageHeight ?? 0.52));
	const titleHeight = Math.round(height * 0.12);
	const rowHeight = (height - imageHeight - titleHeight) / template.rows.length;
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, cardWidth, height);
	ctx.fillStyle = "#26344d";
	ctx.fillRect(0, 0, width, imageHeight);
	if (image)
		drawImageFit(ctx, image.image, 0, 0, width, imageHeight, settings.fit, image.x, image.y);
	else textBox(ctx, `IMAGE ${card.id}`, 0, 0, width, imageHeight, width * 0.07, "#94a3b8");
	ctx.fillStyle = template.titleColor;
	ctx.fillRect(0, imageHeight, width, titleHeight);
	const title = `${card.fields.title || "Untitled"}${card.fields.year ? ` (${card.fields.year})` : ""}`;
	textBox(
		ctx,
		title.toUpperCase(),
		gap / 2,
		imageHeight + gap / 4,
		width - gap,
		titleHeight - gap / 2,
		width * 0.064,
		template.textColor,
		3,
		template,
	);
	template.rows.forEach((row, index) => {
		const y = imageHeight + titleHeight + index * rowHeight;
		ctx.fillStyle = row.color;
		ctx.fillRect(0, y + gap, width, rowHeight - gap);
		textBox(
			ctx,
			`${row.label}:`,
			gap / 2,
			y + gap,
			width * 0.57 - gap,
			rowHeight - gap,
			width * 0.075,
			template.textColor,
			2,
			template,
		);
		textBox(
			ctx,
			card.fields[row.key] ?? "—",
			width * 0.57,
			y + gap,
			width * 0.43 - gap / 2,
			rowHeight - gap,
			width * 0.083,
			row.valueColor,
			2,
			template,
		);
	});
	return canvas;
}
export function drawScroll(
	ctx: CanvasRenderingContext2D,
	cards: HTMLCanvasElement[],
	time: number,
	settings: ScrollSettings,
) {
	const { width, height, cardWidth } = geometry(settings.format);
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, width, height);
	cards.forEach((card, index) => {
		const x = cardX(index, cards.length, time, settings);
		if (x < width && x + cardWidth > 0) ctx.drawImage(card, x, 0);
	});
}
