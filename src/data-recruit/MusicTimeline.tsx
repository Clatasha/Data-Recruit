import { useRef, useState } from "react";
import { type MusicClip, musicSpan, splitMusic } from "./music";

export function MusicTimeline({
	clips,
	total,
	time,
	busy,
	onChange,
	onFiles,
	onPick,
	onSeek,
}: {
	clips: MusicClip[];
	total: number;
	time: number;
	busy: boolean;
	onChange: (clips: MusicClip[]) => void;
	onFiles: (files: File[], at: number) => void;
	onPick?: (at: number) => void;
	onSeek: (at: number) => void;
}) {
	const [selected, setSelected] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const pointer = useRef<{
		id: string;
		x: number;
		at: number;
		width: number;
		moved: boolean;
	} | null>(null);
	const clip = clips.find((item) => item.id === selected);
	const span = Math.max(total, ...clips.map((item) => item.at + item.duration));
	const edit = (patch: Partial<MusicClip>) => {
		if (!clip) return;
		const next = { ...clip, ...patch };
		next.duration = Math.max(
			0.1,
			Math.min(next.duration, 1200 - next.at, next.loop ? 1200 : musicSpan(next)),
		);
		next.fadeIn = Math.min(next.fadeIn, next.duration);
		next.fadeOut = Math.min(next.fadeOut, next.duration);
		next.loopOffset %= musicSpan(next);
		onChange(clips.map((item) => (item.id === clip.id ? next : item)));
	};

	return (
		<div className="dr-music" aria-label="Music timeline" role="region" aria-busy={busy}>
			<div className="dr-section-title">
				MUSIC / AUDIO <span>{clips.length} clips · exports with your video</span>
				<button
					type="button"
					disabled={busy}
					onClick={() => (onPick ? onPick(time) : fileInput.current?.click())}
				>
					＋ Add audio
				</button>
				<input
					ref={fileInput}
					aria-label="Add audio files"
					hidden
					type="file"
					accept="audio/*"
					multiple
					onChange={(event) => {
						onFiles(Array.from(event.target.files || []), time);
						event.target.value = "";
					}}
				/>
			</div>
			<div className="dr-audio-scroll">
				<div
					className="dr-audio-lanes"
					style={{ minWidth: Math.max(480, span * 12) }}
					onDragOver={(event) => {
						if (!busy) event.preventDefault();
					}}
					onDrop={(event) => {
						event.preventDefault();
						if (busy) return;
						const rect = event.currentTarget.getBoundingClientRect();
						onFiles(
							Array.from(event.dataTransfer.files),
							Math.max(0, Math.min(total, ((event.clientX - rect.left) / rect.width) * span)),
						);
					}}
				>
					<div
						className="dr-audio-ruler"
						onClick={(event) => {
							const rect = event.currentTarget.getBoundingClientRect();
							onSeek(
								Math.min(total, Math.max(0, ((event.clientX - rect.left) / rect.width) * span)),
							);
						}}
						role="presentation"
					>
						{Array.from({ length: 9 }, (_, index) => (
							<span key={index} style={{ left: `${index * 12.5}%` }}>
								{Math.round((span * index) / 8)}s
							</span>
						))}
					</div>
					{clips.length ? (
						clips.map((item) => (
							<div className="dr-audio-lane" key={item.id}>
								<button
									type="button"
									disabled={busy}
									aria-label={`Audio clip ${item.name}`}
									aria-pressed={selected === item.id}
									className={`dr-audio-clip${item.muted ? " muted" : ""}`}
									style={{
										left: `${(item.at / span) * 100}%`,
										width: `${(item.duration / span) * 100}%`,
									}}
									onClick={() => setSelected(item.id)}
									onPointerDown={(event) => {
										if (busy) return;
										setSelected(item.id);
										event.currentTarget.setPointerCapture(event.pointerId);
										pointer.current = {
											id: item.id,
											x: event.clientX,
											at: item.at,
											width: event.currentTarget.parentElement!.clientWidth,
											moved: false,
										};
									}}
									onPointerMove={(event) => {
										const drag = pointer.current;
										if (!drag || drag.id !== item.id) return;
										if (Math.abs(event.clientX - drag.x) > 3) drag.moved = true;
										if (drag.moved)
											event.currentTarget.style.left = `${(Math.max(0, Math.min(1200 - item.duration, drag.at + ((event.clientX - drag.x) / drag.width) * span)) / span) * 100}%`;
									}}
									onPointerUp={(event) => {
										const drag = pointer.current;
										pointer.current = null;
										if (!drag?.moved) return;
										onChange(
											clips.map((value) =>
												value.id === drag.id
													? {
															...value,
															at: Math.max(
																0,
																Math.min(
																	1200 - value.duration,
																	drag.at + ((event.clientX - drag.x) / drag.width) * span,
																),
															),
														}
													: value,
											),
										);
									}}
									onPointerCancel={() => {
										pointer.current = null;
									}}
								>
									<svg viewBox="0 0 320 40" preserveAspectRatio="none" aria-hidden="true">
										{Array.from({ length: 160 }, (_, i) => {
											const local = (i / 160) * item.duration;
											const source =
												item.start +
												(item.loop ? (local + item.loopOffset) % musicSpan(item) : local);
											const peak =
												item.peaks[
													Math.min(159, Math.floor((source / item.buffer.duration) * 160))
												] ?? 0;
											return (
												<line
													key={i}
													x1={i * 2}
													x2={i * 2}
													y1={20 - Math.max(1, peak * 19)}
													y2={20 + Math.max(1, peak * 19)}
												/>
											);
										})}
									</svg>
									<span>
										{item.muted ? "Muted · " : ""}
										{item.name}
									</span>
								</button>
							</div>
						))
					) : (
						<div className="dr-audio-empty">Drop music here or use ＋ Add audio</div>
					)}
					<div className="dr-audio-playhead" style={{ left: `${(time / span) * 100}%` }} />
					<div
						className="dr-audio-end"
						style={{ left: `${(total / span) * 100}%` }}
						title="Video ends here; audio after this point is not exported"
					/>
				</div>
			</div>
			{clip && (
				<fieldset disabled={busy} className="dr-audio-controls">
					<legend>{clip.name}</legend>
					{(
						[
							[
								"Timeline start",
								clip.at,
								0,
								1200 - clip.duration,
								(value: number) => edit({ at: value }),
							],
							[
								"Source start",
								clip.start,
								0,
								(clip.end ?? clip.buffer.duration) - 0.1,
								(value: number) =>
									edit({
										start: value,
										loopOffset: 0,
										duration: clip.loop
											? clip.duration
											: Math.min(clip.duration, (clip.end ?? clip.buffer.duration) - value),
									}),
							],
							[
								"Source end",
								clip.end ?? clip.buffer.duration,
								clip.start + 0.1,
								clip.buffer.duration,
								(value: number) =>
									edit({
										end: value,
										loopOffset: 0,
										duration: clip.loop
											? clip.duration
											: Math.min(clip.duration, value - clip.start),
									}),
							],
							[
								"Audio duration",
								clip.duration,
								0.1,
								clip.loop ? 1200 - clip.at : Math.min(1200 - clip.at, musicSpan(clip)),
								(value: number) =>
									edit({
										duration: value,
										fadeIn: Math.min(clip.fadeIn, value),
										fadeOut: Math.min(clip.fadeOut, value),
									}),
							],
							[
								"Fade in",
								clip.fadeIn,
								0,
								clip.duration,
								(value: number) => edit({ fadeIn: value }),
							],
							[
								"Fade out",
								clip.fadeOut,
								0,
								clip.duration,
								(value: number) => edit({ fadeOut: value }),
							],
						] as const
					).map(([label, value, min, max, change]) => (
						<label key={label}>
							{label} (s)
							<input
								aria-label={label}
								type="number"
								step="0.1"
								min={min}
								max={max}
								value={Number(value.toFixed(3))}
								onChange={(event) =>
									change(Math.max(min, Math.min(max, Number(event.target.value) || 0)))
								}
							/>
						</label>
					))}
					<label>
						Clip volume · {Math.round(clip.volume * 100)}%
						<input
							aria-label="Audio clip volume"
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={clip.volume}
							onChange={(event) => edit({ volume: Number(event.target.value) })}
						/>
					</label>
					<label>
						<input
							type="checkbox"
							checked={clip.muted}
							onChange={(event) => edit({ muted: event.target.checked })}
						/>{" "}
						Mute clip
					</label>
					<label>
						<input
							type="checkbox"
							checked={clip.loop}
							onChange={(event) =>
								edit({
									loop: event.target.checked,
									loopOffset: 0,
									duration: event.target.checked
										? Math.max(0.1, total - clip.at)
										: Math.min(clip.duration, musicSpan(clip)),
								})
							}
						/>{" "}
						Loop to fill
					</label>
					<div className="dr-inline">
						<button
							type="button"
							disabled={
								clips.length >= 100 || time - clip.at < 0.1 || clip.at + clip.duration - time < 0.1
							}
							onClick={() => {
								const split = splitMusic(clip, time);
								if (split)
									onChange(clips.flatMap((item) => (item.id === clip.id ? split : [item])));
							}}
						>
							Split at playhead
						</button>
						<button
							type="button"
							disabled={clips.length >= 100}
							onClick={() => {
								const duplicate = {
									...clip,
									id: crypto.randomUUID(),
									at: Math.min(1200 - clip.duration, clip.at + clip.duration),
								};
								onChange([...clips, duplicate]);
								setSelected(duplicate.id);
							}}
						>
							Duplicate
						</button>
						<button
							type="button"
							onClick={() => {
								onChange(clips.filter((item) => item.id !== clip.id));
								setSelected(null);
							}}
						>
							Delete
						</button>
					</div>
					<small>
						Clip volume and fades affect export. Music past the video end is trimmed automatically.
					</small>
				</fieldset>
			)}
		</div>
	);
}
