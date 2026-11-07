// chrome-launch - headless Chrome on a port of its own, in a folder of its own, gone without a trace when closed or
// when its starter dies (CONTRACT.md HC1).
//
// Each Chrome is given a launch folder, `ch-XXXXXX` in the temporary folder, as its own temporary folder: Chrome
// makes its lock folder there -- `.com.google.Chrome.XXXXXX`, or with no leading dot on a later Chrome, holding its
// singleton socket -- and further folders of the same name it never removes, and its profile is made there too
// unless the caller names one. So one removal takes everything Chrome made outside a caller's profile, in either
// spelling, and nothing of it can land beside another Chrome's. The launch folder is handed to the starter's warden
// before it is made, and Chrome is started through the tether, so a starter that ends without closing Chrome -- killed
// before Chrome starts, while it runs, or after it has exited of itself -- still has Chrome stopped and the folder
// removed. The launch folder is a scratch folder of clean-runner's, and Chrome its tethered process, so their lifetime
// is clean-runner's, through its public surface alone.
//
// The debugging port is 0, so the system gives Chrome a free one, which Chrome writes to the first line of
// DevToolsActivePort in its profile; a port chosen from a range can be held by any other program, another Chrome
// among them. A socket address holds 107 characters, and Chrome does not start when its lock socket's path is
// longer, so a temporary folder too long for it is refused before Chrome is started.
import type { ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { removeScratchFolder, scratchFolder, spawnTethered, stopGroup } from "@apnex/clean-runner";

import { LAUNCH_FOLDER_PREFIX, lockSocketWarning } from "./chrome-folders.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The flags every Chrome is started with, before the caller's own; the debugging port, profile and page follow the caller's. */
const CHROME_FLAGS: readonly string[] = [
	"--headless=new",
	"--no-sandbox",
	"--disable-gpu",
	"--no-first-run",
	"--no-default-browser-check",
	// an extension Chrome installs at startup from the machine's own list makes it rebuild the request machinery of
	// open pages, cancelling whatever is in flight: measured as about one load in sixty stopped
	"--disable-extensions",
	// no request of Chrome's own reaches the network while a test counts the page's
	"--disable-background-networking",
	"--disable-component-update",
	"--disable-sync",
	"--metrics-recording-only",
	// keep Chrome's secrets in its profile: otherwise every Chrome rewrites the user's login keyring, outside every
	// folder of the run (measured, Chrome 136 on a desktop with a keyring)
	"--password-store=basic",
];

const CHROME_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

/** How a Chrome exited: its exit code, or the signal that ended it. */
export interface ExitState {
	readonly code: number | null;
	readonly signal: string | null;
}

export interface ChromeOptions {
	/** The page Chrome opens; "about:blank" by default. */
	readonly url?: string;
	/** Flags of the caller's own, after the shared ones: a window size, a start option. */
	readonly args?: readonly string[];
	/** A profile of the caller's, kept when Chrome closes; by default a profile in the launch folder, removed with it. */
	readonly profile?: string;
	/** The Chrome to start; findChrome() by default. */
	readonly chrome?: string;
	/** How long Chrome may take to write its port, in milliseconds; 60000 by default. */
	readonly startTimeoutMs?: number;
}

export interface LaunchedChrome {
	/** The process group's id: Chrome's tether leads it. */
	readonly pid: number;
	/** The debugging port the system gave Chrome. */
	readonly port: number;
	/** How long Chrome's start took: the milliseconds from its spawn to its debugging port read. */
	readonly startMs: number;
	/** The launch folder: Chrome's temporary folder, holding its lock folder and, unless one was given, its profile. */
	readonly folder: string;
	/** Chrome's profile. */
	readonly profile: string;
	/** How Chrome exited, or null while it runs. */
	exited(): ExitState | null;
	/** Stops Chrome's whole process group and whatever still names the launch folder, then removes the folder; never throws, and a second call does nothing more. A Chrome never holds this process open. */
	close(): Promise<void>;
}

/** Chrome to start: `$CHROME` when set, else the first of google-chrome, google-chrome-stable, chromium and chromium-browser found on PATH, else null. */
export function findChrome(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
	if (env === null || typeof env !== "object") throw new TypeError("findChrome: env must be an object");
	if (env.CHROME) return env.CHROME;
	for (const name of CHROME_NAMES) {
		for (const dir of (env.PATH ?? "").split(path.delimiter)) {
			if (dir === "") continue;
			const file = path.join(dir, name);
			try {
				fs.accessSync(file, fs.constants.X_OK);
				if (fs.statSync(file).isFile()) return file;
			} catch {
				// not here
			}
		}
	}
	return null;
}

function readCommonOptions(name: string, options: { readonly args?: unknown; readonly chrome?: unknown }): { args: readonly string[]; chrome: string } {
	if (options.args !== undefined && !(Array.isArray(options.args) && options.args.every((a) => typeof a === "string"))) throw new TypeError(`${name}: args must be an array of strings`);
	if (options.chrome !== undefined && (typeof options.chrome !== "string" || options.chrome === "")) throw new TypeError(`${name}: chrome must be a non-empty string`);
	const chrome = (options.chrome as string | undefined) ?? findChrome();
	if (chrome === null) throw new Error(`${name}: no Chrome found: set CHROME to its path, or put google-chrome or chromium on PATH`);
	return { args: (options.args as readonly string[] | undefined) ?? [], chrome };
}

const readTimeout = (name: string, key: string, value: unknown, fallback: number): number => {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`${name}: ${key} must be a positive number of milliseconds`);
	return value;
};

/**
 * Makes a launch folder in the temporary folder, refusing one too long for Chrome's lock socket; the folder is handed
 * to this process's warden before it is made, so it goes once this process has ended, whenever that is.
 */
function makeLaunchFolder(name: string): string {
	const warning = lockSocketWarning(os.tmpdir());
	if (warning !== null) throw new Error(`${name}: ${warning}`);
	try {
		return scratchFolder(LAUNCH_FOLDER_PREFIX);
	} catch (error) {
		throw new Error(`${name}: ${(error as Error).message}`);
	}
}

/**
 * Chrome's environment: this process's, with the launch folder as its temporary folder and the home of its
 * configuration. Chrome's crash reporter keeps its settings and its reports under the configuration home, not the
 * profile -- every launch rewrote the user's `Crash Reports/settings.dat`, and every crash added a report there
 * (measured, Chrome 136) -- so with this they land in the launch folder and go with it.
 */
const chromeEnv = (folder: string): Record<string, string | undefined> => ({ ...process.env, TMPDIR: folder, XDG_CONFIG_HOME: path.join(folder, "config") });

/** How long launchChrome waits for Chrome to write its port by default: a cold start on GitHub's runner has taken 25 seconds. */
const START_TIMEOUT_MS = 60000;

/** How long a Chrome is given to end once asked, by SIGTERM to its group, before its group is killed by SIGKILL. */
const STOP_GRACE_MS = 5000;

/** How a Chrome exited, as a message says it. */
const exitWords = ({ code, signal }: ExitState): string => (signal === null ? `exit code ${code}` : `signal ${signal}`);

/**
 * The error of a start that wrote no port, saying what Chrome was doing: exited, with its code or signal; or still
 * running when the start bound passed, and then how it ended once stopped -- ending when asked, it was alive and
 * starting slowly; needing SIGKILL, or not ending even then, it was hung.
 */
function startFailure(chrome: string, portFile: string, startTimeoutMs: number, startedAt: number, exitedFirst: ExitState | null, afterStop: ExitState | null): Error {
	if (exitedFirst !== null) {
		return new Error(`launchChrome: Chrome exited before it wrote its debugging port, ${Date.now() - startedAt} ms into the start bound of ${startTimeoutMs} ms: ${exitWords(exitedFirst)} (${chrome})`);
	}
	const bound = `launchChrome: Chrome wrote no debugging port to ${portFile} within the start bound of ${startTimeoutMs} ms (startTimeoutMs)`;
	if (afterStop === null) return new Error(`${bound}; it was still running then, and did not end even when killed: hung (${chrome})`);
	if (afterStop.signal === "SIGKILL") return new Error(`${bound}; it was still running then, and did not end within ${STOP_GRACE_MS} ms of being asked, so it was killed: hung (${chrome})`);
	return new Error(`${bound}; it was still running then, and ended when asked (${exitWords(afterStop)}): a slow start, not a hung one (${chrome})`);
}

/** How long a launch folder's removal is tried, at most, before the warden is left to remove it once the starter ends. */
const LAUNCH_FOLDER_REMOVAL_MS = 15000;

/**
 * Removes a launch folder, with every process still naming it -- the crash handlers, which leave Chrome's group -- and,
 * once it is gone, takes it back from the warden, so nothing later standing at its path is removed. A process no stop
 * reaches -- a crash handler outside Chrome's group, whose rewritten title names the folder in no way processesNaming
 * finds -- may still be writing into it, and one removal then fails, its retries sweeping the folder only once; so it is
 * tried again, what names the folder stopped again and the folder removed, until it is gone or the bound has passed,
 * when the warden still holds it. Answers whether it is gone; never throws.
 */
async function removeLaunchFolder(folder: string): Promise<boolean> {
	for (const until = Date.now() + LAUNCH_FOLDER_REMOVAL_MS; ; ) {
		try {
			if (await removeScratchFolder(folder)) return true;
		} catch {
			// removed and taken back already: nothing is left at the path
			return true;
		}
		if (Date.now() >= until) return false;
		await sleep(100);
	}
}

/** Stops what is left of a Chrome, waits a bounded time for its tether's exit to be seen, and removes its launch folder. */
async function removeChrome(pid: number | undefined, folder: string, exit: Promise<unknown>): Promise<void> {
	try {
		if (pid !== undefined) await stopGroup(pid, STOP_GRACE_MS);
		await Promise.race([exit, sleep(2000)]);
	} finally {
		await removeLaunchFolder(folder);
	}
}

/**
 * Starts headless Chrome, tethered to this process, in a launch folder of its own, on a debugging port the system
 * gives it, and answers once Chrome has written that port, with how long its start took.
 */
export async function launchChrome(options: ChromeOptions = {}): Promise<LaunchedChrome> {
	if (options === null || typeof options !== "object") throw new TypeError("launchChrome: options must be an object");
	const { args, chrome } = readCommonOptions("launchChrome", options);
	if (options.url !== undefined && typeof options.url !== "string") throw new TypeError("launchChrome: url must be a string");
	if (options.profile !== undefined && (typeof options.profile !== "string" || options.profile === "")) throw new TypeError("launchChrome: profile must be a path");
	const startTimeoutMs = readTimeout("launchChrome", "startTimeoutMs", options.startTimeoutMs, START_TIMEOUT_MS);
	const folder = makeLaunchFolder("launchChrome");
	const profile = options.profile === undefined ? path.join(folder, "profile") : path.resolve(options.profile);
	// a port left by an earlier Chrome on the same profile is not this one's
	fs.rmSync(path.join(profile, "DevToolsActivePort"), { force: true });
	let exitState: ExitState | null = null;
	let child: ChildProcess;
	const startedAt = Date.now();
	try {
		child = spawnTethered(chrome, [...CHROME_FLAGS, ...args, `--user-data-dir=${profile}`, "--remote-debugging-port=0", options.url ?? "about:blank"], {
			env: chromeEnv(folder),
			stdio: "ignore",
		});
	} catch (error) {
		await removeLaunchFolder(folder);
		throw error;
	}
	// a Chrome never holds its starter open: a test that forgets to close it ends, and its tether then stops it and
	// records it, so the run names it rather than waiting on it for ever
	child.unref();
	child.channel?.unref();
	const exit = new Promise<void>((resolve) => {
		child.on("exit", (code, signal) => resolve(void (exitState ??= { code, signal })));
		child.on("error", () => resolve(void (exitState ??= { code: null, signal: null })));
	});
	const pid = child.pid;
	let closing: Promise<void> | null = null;
	const close = (): Promise<void> => (closing ??= removeChrome(pid, folder, exit).catch(() => undefined));
	const portFile = path.join(profile, "DevToolsActivePort");
	let port = 0;
	for (const until = startedAt + startTimeoutMs; port === 0; ) {
		if (exitState !== null) {
			const exitedFirst = exitState as ExitState;
			const failure = startFailure(chrome, portFile, startTimeoutMs, startedAt, exitedFirst, exitedFirst);
			await close();
			throw failure;
		}
		try {
			port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]) || 0;
		} catch {
			// not written yet
		}
		if (port !== 0) break;
		if (Date.now() >= until) {
			// what Chrome was doing when the bound passed: exited, or still running -- and then how it ends once stopped
			const exitedFirst = exitState as ExitState | null;
			await close();
			throw startFailure(chrome, portFile, startTimeoutMs, startedAt, exitedFirst, exitState as ExitState | null);
		}
		await sleep(25);
	}
	const startMs = Date.now() - startedAt;
	return Object.freeze({ pid: pid as number, port, startMs, folder, profile, exited: () => exitState, close });
}

export interface DumpDomOptions {
	/** Flags of the caller's own, after the shared ones. */
	readonly args?: readonly string[];
	/** The Chrome to start; findChrome() by default. */
	readonly chrome?: string;
	/** The virtual time the page is given to settle before its DOM is written, in milliseconds; 10000 by default. */
	readonly virtualTimeBudgetMs?: number;
	/** How long Chrome may take in all, in milliseconds; 60000 by default. */
	readonly timeoutMs?: number;
}

/**
 * Loads `url` in a one-shot headless Chrome -- `--dump-dom`, given a virtual time budget -- in a launch folder of its
 * own, through the tether, and answers the DOM Chrome writes; the folder is removed whatever happens.
 */
export async function dumpDom(url: string, options: DumpDomOptions = {}): Promise<string> {
	if (typeof url !== "string" || url === "") throw new TypeError("dumpDom: the url must be a non-empty string");
	if (options === null || typeof options !== "object") throw new TypeError("dumpDom: options must be an object");
	const { args, chrome } = readCommonOptions("dumpDom", options);
	const budget = readTimeout("dumpDom", "virtualTimeBudgetMs", options.virtualTimeBudgetMs, 10000);
	const timeoutMs = readTimeout("dumpDom", "timeoutMs", options.timeoutMs, 60000);
	const folder = makeLaunchFolder("dumpDom");
	const out = path.join(folder, "dom.html");
	let pid: number | undefined;
	let exit: Promise<unknown> = Promise.resolve();
	try {
		const fd = fs.openSync(out, "w");
		let child: ChildProcess;
		try {
			child = spawnTethered(chrome, [...CHROME_FLAGS, ...args, `--user-data-dir=${path.join(folder, "profile")}`, `--virtual-time-budget=${budget}`, "--dump-dom", url], {
				env: chromeEnv(folder),
				stdio: ["ignore", fd, "ignore"],
			});
		} finally {
			fs.closeSync(fd);
		}
		pid = child.pid;
		const ending = new Promise<ExitState>((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
		exit = ending;
		const ended = await Promise.race([ending, new Promise<null>((resolve) => setTimeout(resolve, timeoutMs, null).unref())]);
		if (ended === null) throw new Error(`dumpDom: Chrome gave no answer within ${timeoutMs} ms (${url})`);
		if (ended.code !== 0) throw new Error(`dumpDom: Chrome exited with ${ended.signal === null ? `exit code ${ended.code}` : `signal ${ended.signal}`} (${url})`);
		return fs.readFileSync(out, "utf8");
	} finally {
		await removeChrome(pid, folder, exit);
	}
}
