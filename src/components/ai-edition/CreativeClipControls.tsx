import { useScopedT } from "@/contexts/I18nContext";
import {
	type CreativeSettings,
	DEFAULT_CREATIVE_SETTINGS,
} from "@/lib/ai-edition/creative/settings";
import styles from "./NewEditorShell.module.css";

export function CreativeClipControls({
	value,
	onChange,
	disabled,
}: {
	value: CreativeSettings;
	onChange: (value: CreativeSettings) => void;
	disabled: boolean;
}) {
	const t = useScopedT("settings");
	const patch = (next: Partial<CreativeSettings>) => onChange({ ...value, ...next });
	return (
		<fieldset
			disabled={disabled}
			style={{
				border: "1px solid var(--border-soft)",
				borderRadius: 10,
				padding: 12,
				margin: "8px 0",
				display: "grid",
				gap: 10,
			}}
		>
			<legend>{t("creative.title")}</legend>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
				{(["flipHorizontal", "flipVertical", "reverse"] as const).map((key) => (
					<label key={key}>
						<input
							type="checkbox"
							checked={value[key]}
							onChange={(event) => patch({ [key]: event.target.checked })}
						/>{" "}
						{t(`creative.${key}`)}
					</label>
				))}
			</div>
			<label>
				{t("creative.overlay")}{" "}
				<select
					className={styles.control}
					value={value.overlay}
					onChange={(event) =>
						patch({ overlay: event.target.value as CreativeSettings["overlay"] })
					}
				>
					{(["none", "matrix", "dots", "particles"] as const).map((key) => (
						<option key={key} value={key}>
							{t(`creative.${key}`)}
						</option>
					))}
				</select>
			</label>
			{value.overlay !== "none" && (
				<>
					<label>
						{t("creative.color")}{" "}
						<input
							type="color"
							value={value.color}
							onChange={(event) => patch({ color: event.target.value })}
						/>
					</label>
					{(
						[
							["opacity", 0, 1, 0.01],
							["speed", 0.25, 3, 0.05],
							["density", 0.1, 1, 0.05],
							["size", 0.5, 3, 0.1],
						] as const
					).map(([key, min, max, step]) => (
						<label
							key={key}
							style={{
								display: "grid",
								gridTemplateColumns: "90px 1fr 50px",
								alignItems: "center",
								gap: 8,
							}}
						>
							{t(`creative.${key}`)}
							<input
								type="range"
								min={min}
								max={max}
								step={step}
								value={value[key]}
								onChange={(event) => patch({ [key]: Number(event.target.value) })}
							/>
							<output>
								{key === "opacity" || key === "density"
									? `${Math.round(value[key] * 100)}%`
									: `${value[key].toFixed(1)}×`}
							</output>
						</label>
					))}
				</>
			)}
			<small>{t("creative.help")}</small>
			<button
				type="button"
				className={`${styles.btn} ${styles.btnSecondary}`}
				onClick={() => onChange({ ...DEFAULT_CREATIVE_SETTINGS })}
			>
				{t("creative.clear")}
			</button>
		</fieldset>
	);
}
