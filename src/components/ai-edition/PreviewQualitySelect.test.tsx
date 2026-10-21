// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePreviewPreferences } from "@/lib/ai-edition/previewPreferences";
import { PreviewQualitySelect } from "./PreviewQualitySelect";

vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
afterEach(() => {
	cleanup();
	usePreviewPreferences.setState({ quality: "auto" });
});
it("exposes preview quality directly without opening Workspace", () => {
	render(<PreviewQualitySelect />);
	fireEvent.change(screen.getByRole("combobox", { name: "preview.quality" }), {
		target: { value: "quarter" },
	});
	expect(usePreviewPreferences.getState().quality).toBe("quarter");
});
