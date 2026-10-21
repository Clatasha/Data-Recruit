// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
// Model Radix's exit animation: content can remain mounted after open becomes false.
vi.mock("@/components/ui/popover", () => ({
	Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
	PopoverAnchor: () => null,
	PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { TimelineContextMenu, type TimelineContextTarget } from "./TimelineContextMenu";

afterEach(cleanup);
const target: TimelineContextTarget = { kind: "audio", id: "microphone", x: 50, y: 500 };
it("dispatches Duplicate with its audio target before dismissing the menu", () => {
	const actions: string[] = [];
	const onAction = vi.fn((_action, item) => actions.push(item.id));
	render(
		<TimelineContextMenu
			target={target}
			onClose={() => actions.push("close")}
			onAction={onAction}
		/>,
	);
	fireEvent.click(screen.getByRole("menuitem", { name: "context.duplicate" }));
	expect(onAction).toHaveBeenCalledWith("duplicate", target);
	expect(actions).toEqual(["microphone", "close"]);
});
it("keeps the clicked item when dismissal occurs before an exiting menu's click", () => {
	const onAction = vi.fn();
	const onClose = vi.fn();
	const view = render(
		<TimelineContextMenu target={target} onClose={onClose} onAction={onAction} />,
	);
	view.rerender(<TimelineContextMenu target={null} onClose={onClose} onAction={onAction} />);
	fireEvent.click(screen.getByRole("menuitem", { name: "context.duplicate" }));
	expect(onAction).toHaveBeenCalledWith("duplicate", target);
});

it("exposes disable and unlink for linked media and blocks edits on locked tracks", () => {
	const onAction = vi.fn();
	const view = render(
		<TimelineContextMenu
			target={{ ...target, linked: true }}
			onClose={vi.fn()}
			onAction={onAction}
		/>,
	);
	fireEvent.click(screen.getByRole("menuitem", { name: "context.disable" }));
	expect(onAction).toHaveBeenCalledWith("disable", expect.objectContaining({ id: "microphone" }));
	expect(screen.getByRole("menuitem", { name: "context.unlink" })).toBeEnabled();
	view.rerender(
		<TimelineContextMenu
			target={{ ...target, locked: true }}
			onClose={vi.fn()}
			onAction={onAction}
		/>,
	);
	expect(screen.getByRole("menuitem", { name: "context.delete" })).toBeDisabled();
	expect(screen.getByRole("menuitem", { name: "context.duplicate" })).toBeDisabled();
	expect(screen.getByRole("menuitem", { name: "context.fit" })).toBeEnabled();
});

it("keeps every audio menu row in place while dismissal precedes pointerup", () => {
	const onAction = vi.fn();
	const audioTarget = { ...target, linked: true, muted: true };
	const view = render(
		<TimelineContextMenu target={audioTarget} onClose={vi.fn()} onAction={onAction} />,
	);
	const rows = screen.getAllByRole("menuitem").map((row) => row.textContent);
	const deletion = screen.getByRole("menuitem", { name: "context.delete" });
	fireEvent.pointerDown(deletion, { button: 0 });
	view.rerender(<TimelineContextMenu target={null} onClose={vi.fn()} onAction={onAction} />);
	expect(screen.getAllByRole("menuitem").map((row) => row.textContent)).toEqual(rows);
	expect(screen.getByRole("menuitem", { name: "context.delete" })).toBe(deletion);
	fireEvent.pointerUp(deletion, { button: 0 });
	fireEvent.click(deletion);
	expect(onAction).toHaveBeenCalledWith("delete", audioTarget);
});
