// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecorderMixer } from "./RecorderMixer";

vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
afterEach(cleanup);
const props = () => ({
	levels: { microphone: 75, system: 30 },
	muted: { microphone: false, system: false },
	microphoneEnabled: true,
	systemEnabled: true,
	available: true,
	locked: false,
	recording: true,
	onLevel: vi.fn(),
	onMute: vi.fn(),
	onClose: vi.fn(),
	panelRef: vi.fn(),
});
it("allows volume and mute changes during a take while protecting shortcut settings", () => {
	const input = props();
	render(<RecorderMixer {...input} />);
	const voice = screen.getByRole("slider", { name: "audio.microphone reaction.volume" });
	expect(voice).toBeEnabled();
	fireEvent.change(voice, { target: { value: "50" } });
	expect(input.onLevel).toHaveBeenCalledWith("microphone", 50);
	fireEvent.click(screen.getByRole("button", { name: "reaction.mute audio.microphone" }));
	expect(input.onMute).toHaveBeenCalledWith("microphone");
	fireEvent.click(screen.getByRole("tab", { name: "reaction.hotkeys" }));
	for (const select of screen.getAllByRole("combobox")) expect(select).toBeDisabled();
});
it("prevents controls for sources that were not included in the take", () => {
	render(<RecorderMixer {...props()} microphoneEnabled={false} />);
	expect(screen.getByRole("slider", { name: "audio.microphone reaction.volume" })).toBeDisabled();
	expect(screen.getByRole("slider", { name: "audio.systemAudio reaction.volume" })).toBeEnabled();
});
it("prevents fake live changes on unsupported capture paths", () => {
	render(<RecorderMixer {...props()} available={false} />);
	for (const slider of screen.getAllByRole("slider")) expect(slider).toBeDisabled();
	expect(screen.getByText("reaction.unsupported")).toBeInTheDocument();
});
