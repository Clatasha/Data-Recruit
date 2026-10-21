import { lazy, Suspense, useEffect, useState } from "react";
import "./styles/fonts.css";
import "./styles/design-tokens.css";
import { installBrowserShims } from "./native/browserShim";

installBrowserShims();

import { CountdownOverlay } from "./components/launch/CountdownOverlay.tsx";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { NotesWindow } from "./components/launch/NotesWindow.tsx";
import { SourceSelector } from "./components/launch/SourceSelector";
import { PermissionsWindow } from "./components/permissions/PermissionsWindow";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { EditorDialogsProvider } from "./contexts/EditorDialogsContext";
import { useScopedT } from "./contexts/I18nContext";
import { ShortcutsProvider } from "./contexts/ShortcutsContext";
import { loadAllCustomFonts } from "./lib/customFonts";
import { registerTextFontFaces } from "./lib/textFonts";

const VideoEditorEntry = lazy(() =>
	import("./components/ai-edition/AiEditionShell").then((module) => ({
		default: module.default,
	})),
);
const DataRecruit = lazy(() => import("./data-recruit/DataRecruit"));
const CliExportRunner = lazy(() => import("./cli/CliExportRunner"));
const CliRecordRunner = lazy(() => import("./cli/CliRecordRunner"));
const CliSourcesRunner = lazy(() => import("./cli/CliSourcesRunner"));
const CliCaptionsRunner = lazy(() => import("./cli/CliCaptionsRunner"));
const ShortcutsConfigDialog = lazy(() =>
	import("./components/video-editor/ShortcutsConfigDialog").then((module) => ({
		default: module.ShortcutsConfigDialog,
	})),
);
const ProviderSettingsDialog = lazy(() =>
	import("./components/ai-edition/ProviderSettings").then((module) => ({
		default: module.ProviderSettingsDialog,
	})),
);

export default function App() {
	const [dataSession] = useState(
		() =>
			!new URLSearchParams(window.location.search).get("windowType") ||
			new URLSearchParams(window.location.search).get("windowType") === "data-recruit",
	);
	const [windowType, setWindowType] = useState(
		() => new URLSearchParams(window.location.search).get("windowType") || "data-recruit",
	);
	const showNotes = new URLSearchParams(window.location.search).get("showNotes") === "true";

	const tEditor = useScopedT("editor");

	useEffect(() => {
		const type = new URLSearchParams(window.location.search).get("windowType") || "data-recruit";
		if (type !== windowType) {
			setWindowType(type);
		}

		if (type === "hud-overlay" || type === "source-selector" || type === "countdown-overlay") {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}

		// HUD is a fixed-size BrowserWindow; pin the document shell and hide overflow
		// so the renderer can't introduce scrollbars (see issue #305).
		if (type === "hud-overlay") {
			document.documentElement.style.height = "100%";
			document.documentElement.style.overflow = "hidden";
			document.body.style.height = "100%";
			document.body.style.margin = "0";
			document.body.style.overflow = "hidden";
			const root = document.getElementById("root");
			root?.style.setProperty("height", "100%");
			root?.style.setProperty("min-height", "0");
			root?.style.setProperty("overflow", "hidden");
		}
	}, [windowType]);

	useEffect(() => {
		// Load custom fonts on app initialization
		loadAllCustomFonts().catch((error) => {
			console.error("Failed to load custom fonts:", error);
		});
		registerTextFontFaces();
	}, []);

	const content = (() => {
		switch (windowType) {
			case "data-recruit":
				return null;
			case "hud-overlay":
				return <LaunchWindow />;
			case "source-selector":
				return <SourceSelector />;
			case "countdown-overlay":
				return <CountdownOverlay />;
			case "permissions":
				return <PermissionsWindow />;
			case "cli-export":
				return (
					<Suspense fallback={null}>
						<CliExportRunner />
					</Suspense>
				);
			case "cli-record":
				return (
					<Suspense fallback={null}>
						<CliRecordRunner />
					</Suspense>
				);
			case "cli-sources":
				return (
					<Suspense fallback={null}>
						<CliSourcesRunner />
					</Suspense>
				);
			case "cli-captions":
				return (
					<Suspense fallback={null}>
						<CliCaptionsRunner />
					</Suspense>
				);
			case "editor":
				return (
					<ShortcutsProvider>
						<EditorDialogsProvider>
							<Suspense
								fallback={
									<div className="flex flex-col items-center justify-center gap-3 h-screen bg-[var(--bg)]">
										<svg
											className="animate-spin text-[var(--brand)]"
											xmlns="http://www.w3.org/2000/svg"
											fill="none"
											viewBox="0 0 24 24"
											width={28}
											height={28}
										>
											<circle
												className="opacity-25"
												cx="12"
												cy="12"
												r="10"
												stroke="currentColor"
												strokeWidth="4"
											/>
											<path
												className="opacity-75"
												fill="currentColor"
												d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
											/>
										</svg>
										<span className="text-[var(--muted)] text-sm">{tEditor("loadingEditor")}</span>
									</div>
								}
							>
								<VideoEditorEntry />
								<ShortcutsConfigDialog />
								<ProviderSettingsDialog />
							</Suspense>
						</EditorDialogsProvider>
					</ShortcutsProvider>
				);
			default:
				return (
					<div>
						<div className="w-full h-full bg-background text-foreground">
							<h1>Data Recruit</h1>
						</div>
					</div>
				);
		}
	})();

	return (
		<TooltipProvider>
			{dataSession && (
				<div style={{ display: windowType === "data-recruit" ? "block" : "none" }}>
					<Suspense fallback={null}>
						<DataRecruit
							onOpenEditor={() => {
								window.history.replaceState(null, "", "?windowType=editor");
								setWindowType("editor");
							}}
						/>
					</Suspense>
				</div>
			)}
			{showNotes ? <NotesWindow /> : content}
			{dataSession && windowType === "editor" && (
				<button
					type="button"
					style={{
						position: "fixed",
						bottom: 8,
						right: 16,
						zIndex: 200,
						background: "#203c3b",
						color: "#8ee8d6",
						border: "1px solid #416b63",
						padding: "6px 12px",
						borderRadius: 6,
						fontSize: 11,
					}}
					onClick={() => {
						window.history.replaceState(null, "", "?windowType=data-recruit");
						setWindowType("data-recruit");
					}}
				>
					← Return to builder
				</button>
			)}
			<Toaster />
		</TooltipProvider>
	);
}
