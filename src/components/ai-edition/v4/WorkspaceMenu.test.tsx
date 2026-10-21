// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import { DEFAULT_WORKSPACE, useWorkspace } from "@/lib/workspace";
import { WorkspaceMenu } from "./WorkspaceMenu";

vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
afterEach(() => {
	cleanup();
	useWorkspace.setState(DEFAULT_WORKSPACE);
});
it("saves snapping preferences, offers fit, and resets the workspace", async () => {
	const fit = vi.fn();
	window.addEventListener("reaction-station-fit-timeline", fit);
	render(
		<ShortcutsProvider>
			<WorkspaceMenu />
		</ShortcutsProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "workspace.title" }));
	const snapping = await screen.findByRole("switch", { name: /workspace.snapping/ });
	fireEvent.click(snapping);
	expect(snapping).toHaveAttribute("aria-checked", "false");
	expect(JSON.parse(localStorage.getItem("reaction-station.workspace")!).state.snapping).toBe(
		false,
	);
	const saved = localStorage.getItem("reaction-station.workspace")!;
	act(() => useWorkspace.setState({ snapping: true }));
	localStorage.setItem("reaction-station.workspace", saved);
	await act(() => useWorkspace.persist.rehydrate());
	// Reopening the app restores the previously saved preference.
	expect(snapping).toHaveAttribute("aria-checked", "false");
	fireEvent.click(screen.getByRole("button", { name: "workspace.fitTimeline" }));
	expect(fit).toHaveBeenCalledOnce();
	fireEvent.click(screen.getByRole("switch", { name: "workspace.showGuides" }));
	fireEvent.click(screen.getByRole("button", { name: "workspace.reset" }));
	expect(useWorkspace.getState().showGuides).toBe(true);
	window.removeEventListener("reaction-station-fit-timeline", fit);
});
