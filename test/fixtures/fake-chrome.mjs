#!/usr/bin/env node
// fake-chrome - stands in for Chrome where a test must choose what Chrome does (test/contract/chrome-launch.test.js).
//
// By FAKE_CHROME_MODE:
//   serve (the default) -- as Chrome does: makes its lock folder directly in its temporary folder, named with the
//     leading dot unless FAKE_CHROME_LOCK is "undotted", points the profile's SingletonSocket at the socket file in
//     it, starts a crash handler of its own -- detached into a session of its own, as Chrome's leaves Chrome's group
//     -- listens on a free port and writes it to DevToolsActivePort, and runs until stopped;
//   exit -- exits at once with code 3, writing no port;
//   silent -- runs until stopped, writing no port;
//   dump -- writes a document to standard output and exits 0, as --dump-dom does, having first written the file
//     FAKE_CHROME_MARK names, when it names one, so a test knows the moment it ends;
//   dump-fail -- exits 1 having written nothing.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const mode = process.env.FAKE_CHROME_MODE ?? "serve";
const profile = process.argv.find((a) => a.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
if (mode === "exit") process.exit(3);
if (mode === "dump") {
	process.stdout.write(`<html><body>fake ${process.argv.at(-1)}</body></html>\n`);
	if (process.env.FAKE_CHROME_MARK) fs.writeFileSync(process.env.FAKE_CHROME_MARK, "ended");
	process.exit(0);
}
if (mode === "dump-fail") process.exit(1);
setInterval(() => {}, 1000);
if (mode === "silent") {
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
	server.listen(0, "127.0.0.1", () => {
		fs.writeFileSync(path.join(profile, "DevToolsActivePort"), `${server.address().port}\n/devtools/browser/fake\n`);
		process.stdout.write(`fake chrome ${JSON.stringify({ lock, handler: handler.pid })}\n`);
	});
}
