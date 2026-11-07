#!/usr/bin/env node
// fake-chrome - stands in for Chrome where a test must choose what Chrome does (test/contract/chrome-launch.test.js).
//
// By FAKE_CHROME_MODE:
//   serve (the default) -- as Chrome does: makes its lock folder directly in its temporary folder, named with the
//     leading dot unless FAKE_CHROME_LOCK is "undotted", points the profile's SingletonSocket at the socket file in
//     it, starts a crash handler of its own -- detached into a session of its own, as Chrome's leaves Chrome's group
//     -- listens on a free port and writes it to DevToolsActivePort, and runs until stopped; with FAKE_CHROME_DELAY
//     set to a number of milliseconds it writes the port only that long after it started, as a slow start does;
//   exit -- exits at once with code 3, writing no port;
//   silent -- runs until stopped, writing no port;
//   hung -- runs, writing no port, and ignores SIGTERM, as a hung Chrome does: only SIGKILL ends it;
//   dump -- writes a document to standard output and exits 0, as --dump-dom does, having first written the file
//     FAKE_CHROME_MARK names, when it names one, so a test knows the moment it ends;
//   dump-fail -- exits 1 having written nothing.
//
// With FAKE_CHROME_LATE set to a number of milliseconds, whatever the mode, the fake Chrome leaves a late writer as it
// ends -- stopped, or exiting of itself -- as a crash handler does: detached into a session of its own, so no stop of
// Chrome's group reaches it, its environment and working folder naming nothing of the launch folder, and its title
// naming it only followed by a space, as Chrome's rewritten titles do, so processesNaming does not find it either. It
// fills <launch folder>/config with files for that long, never making the launch folder itself, then writes how many to
// FAKE_CHROME_LATE_MARK's folder; the fake Chrome ends only once it has begun.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

if (process.argv[2] === "--late-writer") {
	// the late writer: its folder only from its title, where a space follows it
	const [, , , ms, title] = process.argv;
	const folder = / --database=(\S+) /.exec(` ${title} `)[1];
	let wrote = 0;
	for (const end = Date.now() + Number(ms); Date.now() < end; ) {
		try {
			// never the launch folder itself: a folder removed under it stays removed
			if (!fs.existsSync(path.join(folder, "config"))) fs.mkdirSync(path.join(folder, "config"));
			fs.writeFileSync(path.join(folder, "config", `late-${wrote}`), "late");
			wrote++;
		} catch {
			// the folder going under it: written again on the next turn
		}
	}
	if (process.env.FAKE_CHROME_LATE_MARK) fs.writeFileSync(path.join(process.env.FAKE_CHROME_LATE_MARK, `late-${process.pid}`), JSON.stringify({ folder, wrote }));
	process.exit(0);
}

const mode = process.env.FAKE_CHROME_MODE ?? "serve";
const late = process.env.FAKE_CHROME_LATE;
/** Leaves the late writer, when FAKE_CHROME_LATE asks for one. */
function leaveLateWriter() {
	if (!late) return;
	const folder = os.tmpdir();
	const env = { PATH: process.env.PATH, ...(process.env.FAKE_CHROME_LATE_MARK ? { FAKE_CHROME_LATE_MARK: process.env.FAKE_CHROME_LATE_MARK } : {}) };
	spawn(process.execPath, [process.argv[1], "--late-writer", late, `chrome_crashpad_handler --database=${folder} --monitor-self`], { detached: true, stdio: "ignore", cwd: "/", env }).unref();
	// ends only once the writer is writing, so a removal that follows always meets it
	for (const end = Date.now() + 5000; Date.now() < end && !fs.existsSync(path.join(folder, "config", "late-0")); );
}
if (late) {
	process.on("SIGTERM", () => {
		leaveLateWriter();
		process.exit(143);
	});
}
const profile = process.argv.find((a) => a.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
if (mode === "exit") {
	leaveLateWriter();
	process.exit(3);
}
if (mode === "dump") {
	process.stdout.write(`<html><body>fake ${process.argv.at(-1)}</body></html>\n`);
	if (process.env.FAKE_CHROME_MARK) fs.writeFileSync(process.env.FAKE_CHROME_MARK, "ended");
	leaveLateWriter();
	process.exit(0);
}
if (mode === "dump-fail") process.exit(1);
setInterval(() => {}, 1000);
if (mode === "hung") process.on("SIGTERM", () => {});
if (mode === "silent" || mode === "hung") {
	// nothing more: no port is written
} else {
	fs.mkdirSync(profile, { recursive: true });
	const lock = path.join(os.tmpdir(), `${process.env.FAKE_CHROME_LOCK === "undotted" ? "" : "."}com.google.Chrome.Fk${String(process.pid % 10000).padStart(4, "0")}`);
	fs.mkdirSync(lock);
	fs.writeFileSync(path.join(lock, "SingletonSocket"), "");
	fs.symlinkSync(path.join(lock, "SingletonSocket"), path.join(profile, "SingletonSocket"));
	const handler = spawn("sleep", ["607"], { detached: true, stdio: "ignore" });
	handler.unref();
	const server = http.createServer((req, res) => res.end("[]"));
	const delay = Number(process.env.FAKE_CHROME_DELAY ?? 0);
	server.listen(0, "127.0.0.1", () => {
		setTimeout(() => {
			fs.writeFileSync(path.join(profile, "DevToolsActivePort"), `${server.address().port}\n/devtools/browser/fake\n`);
			process.stdout.write(`fake chrome ${JSON.stringify({ lock, handler: handler.pid })}\n`);
		}, delay);
	});
}
