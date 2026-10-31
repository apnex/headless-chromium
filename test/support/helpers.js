// helpers - what the contract tests share: bounded waits, starters that can be killed, and the readings of /proc a
// test holds an outcome by.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scratchFolder as scratchFolderFor, spawnWarden as spawnWardenFor } from "@apnex/clean-runner";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CLI = path.join(ROOT, "node_modules", "@apnex", "clean-runner", "dist", "cli.js");
export const PLANTED = (name) => path.join(ROOT, "test", "fixtures", "planted", name);
export const FAKE_CHROME = path.join(ROOT, "test", "fixtures", "fake-chrome.mjs");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `holds` until it answers true or `ms` pass; answers its last answer. */
export async function until(holds, ms) {
	for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) if (await holds()) return true;
	return holds();
}

/** True while a process of that pid runs, a zombie not counted. */
export function running(pid) {
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
		return state !== "Z" && state !== "X";
	} catch {
		return false;
	}
}

/** The running pids of a process group. */
export function groupMembers(pgid) {
	return fs
		.readdirSync("/proc")
		.filter((e) => /^\d+$/.test(e))
		.map(Number)
		.filter((pid) => {
			try {
				const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
				const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
				return fields[0] !== "Z" && Number(fields[2]) === pgid;
			} catch {
				return false;
			}
		});
}

/** The pid of the running process whose parent is `pid` -- a tether's command -- or undefined. */
export function childOf(pid) {
	return fs
		.readdirSync("/proc")
		.filter((e) => /^\d+$/.test(e))
		.map(Number)
		.find((p) => {
			try {
				const stat = fs.readFileSync(`/proc/${p}/stat`, "utf8");
				return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) === pid;
			} catch {
				return false;
			}
		});
}

/** The pids of the wardens -- tethers with no command -- whose parent is `pid`. */
export function wardensOf(pid) {
	return fs
		.readdirSync("/proc")
		.filter((e) => /^\d+$/.test(e))
		.map(Number)
		.filter((p) => {
			try {
				const stat = fs.readFileSync(`/proc/${p}/stat`, "utf8");
				return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) === pid && commandLine(p).includes('"command":null');
			} catch {
				return false;
			}
		});
}

/** A process's command line, spaces between its arguments. */
export const commandLine = (pid) => {
	try {
		return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
	} catch {
		return "";
	}
};

/** How a child exited, once it has. */
export const exitOf = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve({ code: child.exitCode, signal: child.signalCode }) : new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))));

/**
 * A child running `body`, an ES module's source, in the repository, so it imports the package by name; answers the
 * child and a promise of what it writes after "ready " on a line of its own, as JSON. Its environment is this one's,
 * CLEAN_RUNNER_RUN emptied, over `env`.
 */
export function starter(body, env = {}, { coreless = false } = {}) {
	// with this run's mark taken away, so its tethers record nothing in this run's folder: what it leaves when killed is
	// meant to be cleaned; coreless, it runs under a shell that first forbids core dumps to it and all it starts, so a
	// process ended by SIGSEGV or SIGTRAP stores no core anywhere
	const node = [process.execPath, "--input-type=module", "-e", body];
	const [command, ...args] = coreless ? ["sh", "-c", 'ulimit -c 0; exec "$@"', "sh", ...node] : node;
	const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, CLEAN_RUNNER_RUN: "", ...env } });
	let out = "";
	const ready = new Promise((resolve, reject) => {
		child.stdout.on("data", (d) => {
			out += d;
			const m = out.match(/^ready (.*)\n/m);
			if (m) resolve(JSON.parse(m[1]));
		});
		child.once("exit", (code, signal) => reject(new Error(`the starter ended before it was ready (${code ?? signal}): ${out}`)));
	});
	ready.catch(() => {});
	return { child, ready, output: () => out };
}

/**
 * The temporary folder a test hands a runner it starts, so that the runner's run folder and a Chrome's launch folder
 * in it still fit Chrome's lock socket: beside this run's folder when this file runs under a run, not inside it.
 */
export function runnerBase() {
	const tmp = os.tmpdir();
	return process.env.CLEAN_RUNNER_RUN && path.resolve(tmp) === path.resolve(process.env.CLEAN_RUNNER_RUN) ? path.dirname(tmp) : tmp;
}

/**
 * A temporary folder of a test's own, short enough for Chrome's lock socket under it: a folder of four letters beside
 * this run's folder, which a warden removes if this file is killed and the test removes when it is done.
 */
export function privateTmp() {
	const base = runnerBase();
	for (;;) {
		let name = "";
		for (let i = 0; i < 4; i++) name += "abcdefghijklmnopqrstuvwxyz".charAt(Math.floor(Math.random() * 26));
		const folder = path.join(base, name);
		if (fs.existsSync(folder)) continue;
		spawnWardenFor({ remove: [folder] });
		fs.mkdirSync(folder);
		return folder;
	}
}

/** The run folders a runner made in `base`. */
export const runFolders = (base) => fs.readdirSync(base).filter((n) => /^cr-run-[A-Za-z0-9]{6}$/.test(n));

/** Escapes a text for a regular expression. */
export const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A scratch copy of the named files and folders of the repository, removed when this file ends. */
export function scratchCopy(names) {
	const copy = scratchFolderFor("copy-");
	for (const name of names) {
		fs.mkdirSync(path.dirname(path.join(copy, name)), { recursive: true });
		fs.cpSync(path.join(ROOT, name), path.join(copy, name), { recursive: true });
	}
	return copy;
}
