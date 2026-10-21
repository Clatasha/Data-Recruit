import fs from "node:fs/promises";
import path from "node:path";

/** Observe persisted edits without reopening/relinking the project over IPC. */
export async function readRecordingProject(directory, recordingPath, pinnedFile) {
	let files;
	try {
		files = pinnedFile
			? [pinnedFile]
			: (await fs.readdir(directory))
					.filter((name) => name.endsWith(".openscreen"))
					.map((name) => path.join(directory, name));
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
	for (const file of files) {
		try {
			const document = JSON.parse(await fs.readFile(file, "utf8"));
			if (
				document.assets?.some(
					(asset) =>
						typeof asset.originalPath === "string" &&
						path.resolve(asset.originalPath) === path.resolve(recordingPath),
				)
			) {
				return { file, document };
			}
		} catch (error) {
			// A save can replace a file between readdir and readFile.
			if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
		}
	}
	return null;
}
