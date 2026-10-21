// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShortcutsProvider, useShortcuts } from "@/contexts/ShortcutsContext";
import { DEFAULT_SHORTCUTS } from "@/lib/shortcuts";
import { ShortcutsConfigDialog } from "./ShortcutsConfigDialog";

vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
function Harness() {
	const { openConfig } = useShortcuts();
	return (
		<>
			<button type="button" onClick={openConfig}>
				Open shortcuts
			</button>
			<ShortcutsConfigDialog />
		</>
	);
}
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
it("lets users rebind formerly fixed commands and persist a cleared binding", async () => {
	const saveShortcuts = vi.fn().mockResolvedValue({ success: true });
	const updateGlobalShortcut = vi.fn().mockResolvedValue({ success: true });
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: {
			getShortcuts: vi.fn().mockResolvedValue(DEFAULT_SHORTCUTS),
			saveShortcuts,
			updateGlobalShortcut,
		},
	});
	render(
		<ShortcutsProvider>
			<Harness />
		</ShortcutsProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Open shortcuts" }));
	const undo = screen.getByText("actions.undo").parentElement!;
	fireEvent.click(within(undo).getByTitle("clickToChange"));
	fireEvent.keyDown(window, { key: "u", altKey: true });
	expect(within(undo).getByTitle("clickToChange")).toHaveTextContent("Alt + U");
	fireEvent.click(screen.getByRole("button", { name: "clearShortcut: actions.frameBack" }));
	fireEvent.click(screen.getByRole("button", { name: "actions.save" }));
	await waitFor(() => expect(saveShortcuts).toHaveBeenCalledOnce());
	expect(saveShortcuts.mock.calls[0][0]).toMatchObject({
		undo: { key: "u", alt: true },
		frameBack: { key: "" },
	});
	await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
	Object.defineProperty(window, "electronAPI", { configurable: true, value: undefined });
});
