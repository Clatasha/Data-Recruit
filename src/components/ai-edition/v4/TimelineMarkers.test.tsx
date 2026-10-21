// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument, documentSchema } from "@/lib/ai-edition/schema";
import { MARKER_COLORS, TimelineMarkerPin } from "./TimelineMarkers";

vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
afterEach(cleanup);
it("seeks on click and offers rename, seven colors and deletion on right click", () => {
	const onSeek = vi.fn(),
		onChange = vi.fn(),
		onDelete = vi.fn();
	render(
		<TimelineMarkerPin
			marker={{ id: "m1", timeSec: 3, name: "Intro", color: "blue" }}
			left={30}
			onSeek={onSeek}
			onChange={onChange}
			onDelete={onDelete}
		/>,
	);
	fireEvent.click(screen.getByLabelText("Intro"));
	expect(onSeek).toHaveBeenCalledOnce();
	fireEvent.contextMenu(screen.getByLabelText("Intro"));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Reaction starts" } });
	expect(Object.keys(MARKER_COLORS)).toHaveLength(7);
	fireEvent.click(screen.getByLabelText("utilities.colors.purple"));
	expect(onChange).toHaveBeenCalledWith({ color: "purple" });
	fireEvent.click(screen.getByText("utilities.saveMarker"));
	expect(onChange).toHaveBeenCalledWith({ name: "Reaction starts" });
	fireEvent.contextMenu(screen.getByLabelText("Intro"));
	fireEvent.click(screen.getByText("utilities.deleteMarker"));
	expect(onDelete).toHaveBeenCalledOnce();
});
it("round-trips marker data while accepting old projects", () => {
	const doc = createEmptyDocument({ projectId: "test", title: "Test" });
	expect(documentSchema.parse(doc).markers).toBeUndefined();
	const markers = [{ id: "intro", timeSec: 5.5, name: "Intro", color: "green" }];
	expect(documentSchema.parse(JSON.parse(JSON.stringify({ ...doc, markers }))).markers).toEqual(
		markers,
	);
	expect(() =>
		documentSchema.parse({ ...doc, markers: [{ ...markers[0], timeSec: -1 }] }),
	).toThrow();
});
