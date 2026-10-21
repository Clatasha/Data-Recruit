export type MediaDropPlacement = "sequence" | "overlay";
export function droppedMediaKind(name: string): "video" | "image" | "audio" | null {
	const ext = name.split(".").pop()?.toLowerCase();
	if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext ?? "")) return "image";
	if (["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv"].includes(ext ?? "")) return "video";
	if (["wav", "mp3", "m4a", "aac", "ogg", "flac", "opus", "aiff", "aif"].includes(ext ?? ""))
		return "audio";
	return null;
}
export function readDroppedImage(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
		reader.readAsDataURL(file);
	});
}
