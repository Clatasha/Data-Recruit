import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readRecordingProject } from "./recorder-smoke-project.mjs";

const directories = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});
it("pins the fixture's project and observes saved audio edits without opening a different project", async () => {
	const directory = await fs.mkdtemp(path.join(tmpdir(), "reaction-project-smoke-"));
	directories.push(directory);
	const recording = path.join(directory, "recording.webm");
	await fs.writeFile(
		path.join(directory, "other.openscreen"),
		JSON.stringify({ assets: [{ originalPath: "different.webm" }], audioTracks: [] }),
	);
	const file = path.join(directory, "fixture.openscreen");
	const document = { assets: [{ originalPath: recording }], audioTracks: [] };
	await fs.writeFile(file, JSON.stringify(document));
	const initial = await readRecordingProject(directory, recording);
	expect(initial.file).toBe(file);
	expect(initial.document.audioTracks).toHaveLength(0);
	await fs.writeFile(
		file,
		JSON.stringify({
			...document,
			audioTracks: [{ recordingSource: "microphone" }, { recordingSource: "desktop" }],
		}),
	);
	expect(
		(await readRecordingProject(directory, recording, initial.file)).document.audioTracks,
	).toHaveLength(2);
});
it("retries missing and transiently incomplete project files", async () => {
	const directory = await fs.mkdtemp(path.join(tmpdir(), "reaction-project-smoke-"));
	directories.push(directory);
	expect(await readRecordingProject(path.join(directory, "missing"), "/take.webm")).toBeNull();
	const file = path.join(directory, "pending.openscreen");
	await fs.writeFile(file, "{");
	expect(await readRecordingProject(directory, "/take.webm", file)).toBeNull();
});
