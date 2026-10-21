import { Bookmark } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScopedT } from "@/contexts/I18nContext";
import type { AxcutDocument } from "@/lib/ai-edition/schema";
import styles from "./EditorShellV4.module.css";
export type TimelineMarker = NonNullable<AxcutDocument["markers"]>[number];
export type TimelineMarkerEdit =
	| { type: "add"; timeSec: number }
	| { type: "update"; id: string; patch: Partial<Pick<TimelineMarker, "name" | "color">> }
	| { type: "delete"; id: string };
export const MARKER_COLORS = {
	red: "#f87171",
	orange: "#fb923c",
	yellow: "#facc15",
	green: "#4ade80",
	blue: "#60a5fa",
	purple: "#c084fc",
	pink: "#f472b6",
} as const;
export function TimelineMarkerPin({
	marker,
	left,
	onSeek,
	onChange,
	onDelete,
}: {
	marker: TimelineMarker;
	left: number;
	onSeek: () => void;
	onChange: (patch: Partial<Pick<TimelineMarker, "name" | "color">>) => void;
	onDelete: () => void;
}) {
	const t = useScopedT("timeline");
	const [open, setOpen] = useState(false);
	const [name, setName] = useState(marker.name);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					data-timeline-kind="marker"
					className={styles.markerPin}
					style={{ left: `${left}%`, color: MARKER_COLORS[marker.color] }}
					title={`${marker.name} (${marker.timeSec.toFixed(2)}s)`}
					aria-label={marker.name}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => {
						e.preventDefault();
						onSeek();
					}}
					onContextMenu={(e) => {
						e.preventDefault();
						e.stopPropagation();
						setName(marker.name);
						setOpen(true);
					}}
				>
					<Bookmark size={15} fill="currentColor" />
				</button>
			</PopoverTrigger>
			<PopoverContent className={styles.markerMenu} onPointerDown={(e) => e.stopPropagation()}>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						onChange({ name: name.trim() || t("utilities.marker") });
						setOpen(false);
					}}
				>
					<label>
						{t("utilities.markerName")}
						<input
							autoFocus
							maxLength={120}
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</label>
					<div className={styles.markerColors} role="group" aria-label={t("utilities.markerColor")}>
						{Object.entries(MARKER_COLORS).map(([color, hex]) => (
							<button
								key={color}
								type="button"
								aria-label={t(`utilities.colors.${color}`)}
								aria-pressed={marker.color === color}
								style={{ background: hex }}
								onClick={() => onChange({ color: color as TimelineMarker["color"] })}
							/>
						))}
					</div>
					<div className={styles.markerActions}>
						<button
							type="button"
							onClick={() => {
								onDelete();
								setOpen(false);
							}}
						>
							{t("utilities.deleteMarker")}
						</button>
						<button type="submit">{t("utilities.saveMarker")}</button>
					</div>
				</form>
			</PopoverContent>
		</Popover>
	);
}
