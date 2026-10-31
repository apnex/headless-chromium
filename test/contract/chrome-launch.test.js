// chrome-launch - HC1 (CONTRACT.md): headless Chrome on a port the system gives it, in a launch folder of its own,
// gone without a trace when closed, and when its starter is killed.
//
// Real Chrome where the outcome is Chrome's own -- the port, the lock folder it makes, its processes outside its group
// -- and the fake Chrome (test/fixtures/fake-chrome.mjs) where a test must choose what Chrome does: name its lock
// folder with or without the leading dot, exit before it writes a port, never write one. The kill test does what a
// session cut off does to a test: a starter launches Chrome, a server and a scratch folder and is killed by SIGKILL,
// and within a bounded wait no Chrome, no server and no folder of it is left. Last, what a run needs to know of Chrome:
// a temporary folder too long for its lock socket warned of, its lock folder known in either spelling, and a test that
// leaves its Chrome running failing its run under clean-runner's runner, which names the Chrome.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { dumpDom, findChrome, isLockFolderName, launchChrome, lockSocketWarning, serveStatic } from "@apnex/headless-chromium";
import { processesNaming, scratchFolder, spawnTethered } from "@apnex/clean-runner";
import { CLI, commandLine, escaped, exitOf, FAKE_CHROME, groupMembers, PLANTED, privateTmp, ROOT, runnerBase, running, sleep, starter, until } from "../support/helpers.js";

const TEST = { timeout: 60000 };
const NO_CHROME = findChrome() === null && "no Chrome on PATH and no CHROME set";
const LOCK = /^\.?com\.google\.Chrome\.[A-Za-z0-9]{6}$/;
/** The user's own crash reports and their settings, where Chrome's crash reporter keeps them: each file's name and time, or "none". */
function userCrashReports() {
	const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "google-chrome", "Crash Reports");
	if (!fs.existsSync(dir)) return "none";
	return fs
		.readdirSync(dir, { recursive: true })
		.sort()
		.map((name) => `${name} ${fs.statSync(path.join(dir, name)).mtimeMs}`)
		.join("\n");
}

/** Runs `fn` with `vars` set in this process's environment, every key as it was afterwards. */
async function withEnv(vars, fn) {
	const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
	Object.assign(process.env, vars);
	try {
		return await fn();
	} finally {
		for (const [k, v] of Object.entries(before)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	}
}
const environ = (pid) => {
	try {
		return fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
	} catch {
		return [];
	}
};

test("HC1: Chrome is launched headless on the port the system gave it, in a launch folder holding its lock folder and profile, and closing it leaves nothing", { ...TEST, skip: NO_CHROME }, async () => {
	const chrome = await launchChrome();
	let closed = false;
	try {
		assert.deepEqual(Object.keys(chrome), ["pid", "port", "folder", "profile", "exited", "close"]);
		assert.ok(Object.isFrozen(chrome));
		assert.equal(path.dirname(chrome.folder), os.tmpdir());
		assert.match(path.basename(chrome.folder), /^ch-[A-Za-z0-9]{6}$/);
		assert.equal(chrome.profile, path.join(chrome.folder, "profile"));
		const version = await (await fetch(`http://127.0.0.1:${chrome.port}/json/version`)).json();
		assert.match(version.Browser, /Chrome/, "Chrome answers on the port it wrote");
		const lock = path.dirname(fs.readlinkSync(path.join(chrome.profile, "SingletonSocket")));
		assert.equal(path.dirname(lock), chrome.folder, "Chrome made its lock folder in the launch folder");
		assert.match(path.basename(lock), LOCK);
		const main = groupMembers(chrome.pid).map((pid) => [pid, commandLine(pid)]).find(([, line]) => line.includes("--remote-debugging-port=0") && !line.includes("tether-main"));
		assert.ok(main, "control: Chrome's own process runs in the group");
		for (const flag of ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--metrics-recording-only", "--password-store=basic", `--user-data-dir=${chrome.profile}`, "about:blank"]) {
			assert.ok(main[1].split(" ").includes(flag), `Chrome is started with ${flag}`);
		}
		// Chrome writes its process titles over its own environment, so its group is found by group; its crash
		// handlers leave the group, and keep the environment they were started with, the launch folder as TMPDIR
		const handlers = processesNaming(chrome.folder).filter((pid) => !groupMembers(chrome.pid).includes(pid) && environ(pid).includes(`TMPDIR=${chrome.folder}`));
		assert.ok(handlers.length >= 1, "control: Chrome's crash handlers run outside its group, naming the launch folder");
		assert.equal(chrome.exited(), null);
		await chrome.close();
		closed = true;
		assert.deepEqual(groupMembers(chrome.pid), [], "the whole group has gone");
		assert.deepEqual(processesNaming(chrome.folder), [], "and every process naming the launch folder, the crash handlers outside the group among them");
		for (const pid of handlers) assert.equal(running(pid), false);
		assert.equal(fs.existsSync(chrome.folder), false, "the launch folder -- lock folder and profile with it -- is removed");
		assert.notEqual(chrome.exited(), null);
		await chrome.close();
	} finally {
		if (!closed) await chrome.close();
	}
});

test("HC1: a profile of the caller's is kept when Chrome closes, the lock folder removed, and Chrome launches on it again", { ...TEST, skip: NO_CHROME }, async () => {
	const profile = path.join(scratchFolder("cl-"), "profile");
	const first = await launchChrome({ profile });
	const lock = path.dirname(fs.readlinkSync(path.join(profile, "SingletonSocket")));
	await first.close();
	assert.equal(fs.existsSync(path.join(profile, "Default")), true, "the profile is kept");
	assert.equal(fs.existsSync(lock), false, "the lock folder is removed");
	assert.equal(fs.existsSync(first.folder), false);
	const second = await launchChrome({ profile, args: ["--window-size=640,480"] });
	try {
		assert.notEqual(second.port, 0);
		assert.equal(second.profile, profile);
		assert.ok((await fetch(`http://127.0.0.1:${second.port}/json/version`)).ok, "Chrome launched on the profile again answers");
	} finally {
		await second.close();
	}
});

for (const spelling of ["dotted", "undotted"]) {
	test(`HC1: a Chrome naming its lock folder ${spelling === "dotted" ? "with" : "without"} the leading dot has it removed on close, with its profile and its crash handler, and when its starter is killed`, TEST, async () => {
		const env = { FAKE_CHROME_LOCK: spelling };
		const chrome = await withEnv({ ...env, CHROME: FAKE_CHROME }, () => launchChrome());
		const lock = path.dirname(fs.readlinkSync(path.join(chrome.profile, "SingletonSocket")));
		assert.equal(path.basename(lock).startsWith("."), spelling === "dotted", `control: the lock folder is ${path.basename(lock)}`);
		assert.match(path.basename(lock), LOCK);
		const handler = processesNaming(chrome.folder).find((pid) => commandLine(pid) === "sleep 607");
		assert.ok(handler && !groupMembers(chrome.pid).includes(handler), "control: the crash handler runs outside Chrome's group");
		await chrome.close();
		assert.equal(fs.existsSync(lock), false, "the lock folder is removed");
		assert.equal(fs.existsSync(chrome.folder), false, "and the launch folder, the profile with it");
		assert.equal(running(handler), false, "and the crash handler stopped");

		const { child, ready } = starter(`
			import { launchChrome } from "@apnex/headless-chromium";
			import fs from "node:fs"; import path from "node:path";
			const chrome = await launchChrome();
			process.stdout.write("ready " + JSON.stringify({ group: chrome.pid, folder: chrome.folder, lock: path.dirname(fs.readlinkSync(path.join(chrome.profile, "SingletonSocket"))) }) + "\\n");
			setInterval(() => {}, 1000);
		`, { ...env, CHROME: FAKE_CHROME });
		try {
			const killed = await ready;
			assert.match(path.basename(killed.lock), LOCK);
			child.kill("SIGKILL");
			await exitOf(child);
			assert.ok(await until(() => groupMembers(killed.group).length === 0 && processesNaming(killed.folder).length === 0 && !fs.existsSync(killed.folder), 10000), `left: ${processesNaming(killed.folder).map(commandLine)}`);
		} finally {
			child.kill("SIGKILL");
		}
	});
}

test("HC1: a Chrome launched and closed leaves the user's crash reports and login keyring as they were", { ...TEST, skip: NO_CHROME }, async () => {
	const ring = path.join(os.homedir(), ".local", "share", "keyrings", "login.keyring");
	const before = fs.existsSync(ring) ? fs.statSync(ring).mtimeMs : null;
	const reports = userCrashReports();
	const chrome = await launchChrome();
	try {
		const { port } = chrome;
		assert.ok((await fetch(`http://127.0.0.1:${port}/json/version`)).ok, "control: Chrome ran");
		await new Promise((resolve) => setTimeout(resolve, 1500));
	} finally {
		await chrome.close();
	}
	assert.equal(userCrashReports(), reports, "Chrome's crash reporter kept its settings in the launch folder, and wrote nothing to the user's");
	assert.equal(fs.existsSync(ring) ? fs.statSync(ring).mtimeMs : null, before, "Chrome kept its secrets in its profile, and wrote nothing to the keyring");
});

test("HC1: findChrome answers CHROME when set, else the first Chrome on PATH, else null", () => {
	const bin = scratchFolder("cl-bin-");
	assert.equal(findChrome({ CHROME: "/opt/somewhere/chrome", PATH: bin }), "/opt/somewhere/chrome");
	assert.equal(findChrome({ PATH: bin }), null, "an empty PATH holds none");
	fs.writeFileSync(path.join(bin, "chromium"), "#!/bin/sh\n", { mode: 0o755 });
	assert.equal(findChrome({ PATH: `/no/such/dir:${bin}` }), path.join(bin, "chromium"));
	fs.writeFileSync(path.join(bin, "google-chrome"), "#!/bin/sh\n", { mode: 0o644 });
	assert.equal(findChrome({ PATH: bin }), path.join(bin, "chromium"), "a file that is not executable is passed over");
	fs.chmodSync(path.join(bin, "google-chrome"), 0o755);
	assert.equal(findChrome({ PATH: bin }), path.join(bin, "google-chrome"), "google-chrome first");
	assert.equal(findChrome({ CHROME: "", PATH: bin }), path.join(bin, "google-chrome"), "an empty CHROME is unset");
});

test("HC1: a Chrome that exits before writing its port, or never writes one, is refused naming why, and its launch folder removed", TEST, async () => {
	const before = new Set(fs.readdirSync(os.tmpdir()));
	await withEnv({ FAKE_CHROME_MODE: "exit" }, () => assert.rejects(launchChrome({ chrome: FAKE_CHROME }), { name: "Error", message: `launchChrome: Chrome exited before it wrote its debugging port: exit code 3 (${FAKE_CHROME})` }));
	const started = Date.now();
	await withEnv({ FAKE_CHROME_MODE: "silent" }, () => assert.rejects(launchChrome({ chrome: FAKE_CHROME, startTimeoutMs: 400 }), { name: "Error", message: /^launchChrome: Chrome wrote no debugging port to \S+\/profile\/DevToolsActivePort within 400 ms$/ }));
	assert.ok(Date.now() - started < 10000);
	const added = fs.readdirSync(os.tmpdir()).filter((n) => !before.has(n) && n.startsWith("ch-"));
	assert.deepEqual(added, [], "no launch folder is left");
	assert.deepEqual(processesNaming(FAKE_CHROME), [], "and the silent Chrome is stopped");
});

test("HC1: a temporary folder too long for Chrome's lock socket is refused before Chrome is started", TEST, async () => {
	const long = path.join(scratchFolder("cl-"), "a-folder-name-long-enough-to-push-a-lock-socket-past-the-limit-of-it");
	fs.mkdirSync(long);
	await withEnv({ TMPDIR: long }, async () => {
		await assert.rejects(launchChrome({ chrome: FAKE_CHROME }), { name: "Error", message: new RegExp(`^launchChrome: the temporary folder ${escaped(long)} is too long for Chrome's lock socket \\(\\d+ > 107 characters\\): a Chrome launched in it will not start; use a TMPDIR at most \\d+ characters long$`) });
		await assert.rejects(dumpDom("about:blank", { chrome: FAKE_CHROME }), { message: /^dumpDom: the temporary folder \S+ is too long for Chrome's lock socket/ });
	});
	assert.deepEqual(fs.readdirSync(long), [], "nothing was made");
});

test("HC1: dumpDom answers the DOM a page settles to in a one-shot Chrome, and removes its launch folder", { ...TEST, skip: NO_CHROME }, async () => {
	const server = await serveStatic({ pages: { "/": '<!doctype html><title>d</title><p id="out">waiting</p><script>setTimeout(() => { document.getElementById("out").textContent = "settled"; }, 3000)</script>' } });
	const before = new Set(fs.readdirSync(os.tmpdir()));
	try {
		const dom = await dumpDom(`${server.origin}/`, { virtualTimeBudgetMs: 5000 });
		assert.match(dom, /<p id="out">settled<\/p>/, "the page's timer ran in virtual time before the DOM was written");
		assert.deepEqual(server.requests.map((r) => [r.path, r.status]).filter(([p]) => p === "/"), [["/", 200]]);
	} finally {
		await server.close();
	}
	assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((n) => !before.has(n) && n.startsWith("ch-")), [], "no launch folder is left");
});

test("HC1: dumpDom refuses a Chrome that fails or gives no answer in time, and removes its launch folder", TEST, async () => {
	const before = new Set(fs.readdirSync(os.tmpdir()));
	const page = "http://127.0.0.1:9/page";
	assert.equal(await withEnv({ FAKE_CHROME_MODE: "dump" }, () => dumpDom(page, { chrome: FAKE_CHROME })), `<html><body>fake ${page}</body></html>\n`, "control: the fake's document is answered");
	await withEnv({ FAKE_CHROME_MODE: "dump-fail" }, () => assert.rejects(dumpDom(page, { chrome: FAKE_CHROME }), { name: "Error", message: `dumpDom: Chrome exited with exit code 1 (${page})` }));
	await withEnv({ FAKE_CHROME_MODE: "silent" }, () => assert.rejects(dumpDom(page, { chrome: FAKE_CHROME, timeoutMs: 400 }), { name: "Error", message: `dumpDom: Chrome gave no answer within 400 ms (${page})` }));
	assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((n) => !before.has(n) && n.startsWith("ch-")), []);
	assert.deepEqual(processesNaming(FAKE_CHROME), [], "the Chrome that gave no answer is stopped");
});

test("HC1: the kill test -- a starter killed by SIGKILL leaves no Chrome, no server and no folder after a bounded wait", { ...TEST, skip: NO_CHROME }, async () => {
	const { child, ready } = starter(`
		import { launchChrome } from "@apnex/headless-chromium";
		import { scratchFolder, spawnTethered } from "@apnex/clean-runner";
		import fs from "node:fs"; import path from "node:path";
		const data = scratchFolder("kill-data-");
		const chrome = await launchChrome();
		const server = spawnTethered(process.execPath, ["-e", "require('http').createServer((q, s) => s.end('up')).listen(0, '127.0.0.1', function () { process.stdout.write(this.address().port + '\\\\n'); })"], { stdio: ["ignore", "pipe", "inherit"], cwd: data });
		const port = await new Promise((resolve) => server.stdout.once("data", (d) => resolve(Number(String(d).trim()))));
		process.stdout.write("ready " + JSON.stringify({ data, folder: chrome.folder, chrome: chrome.pid, server: server.pid, cdp: chrome.port, port }) + "\\n");
		setInterval(() => {}, 1000);
	`);
	try {
		const { data, folder, chrome, server, cdp, port } = await ready;
		assert.ok((await fetch(`http://127.0.0.1:${cdp}/json/version`)).ok, "control: Chrome answers");
		assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "up", "control: the server answers");
		assert.ok(fs.existsSync(data) && fs.existsSync(folder), "control: both folders exist");
		child.kill("SIGKILL");
		await exitOf(child);
		const clear = await until(() => groupMembers(chrome).length === 0 && groupMembers(server).length === 0 && processesNaming(folder).length === 0 && processesNaming(data).length === 0, 15000);
		assert.ok(clear, `processes outlived the starter killed by SIGKILL: ${[...processesNaming(folder), ...processesNaming(data), ...groupMembers(chrome), ...groupMembers(server)].map(commandLine).join("; ")}`);
		assert.ok(await until(() => !fs.existsSync(folder) && !fs.existsSync(data), 5000), `left behind: ${[folder, data].filter((p) => fs.existsSync(p)).join(", ")}`);
		await assert.rejects(fetch(`http://127.0.0.1:${port}/`), "the server no longer answers");
	} finally {
		child.kill("SIGKILL");
	}
});

/** Kills a starter, then holds that its own temporary folder is left empty, and that nothing names it, within a bound. */
async function killedLeavesNothing(child, tmp, why) {
	child.kill("SIGKILL");
	await exitOf(child);
	const clear = await until(() => fs.readdirSync(tmp).length === 0 && processesNaming(tmp).length === 0, 15000);
	assert.ok(clear, `${why}: left ${fs.readdirSync(tmp).join(", ")}; running ${processesNaming(tmp).map(commandLine).join("; ")}`);
}

test("HC1: a Chrome closed by Browser.close before its starter is killed still has its launch folder, profile and lock folder removed", { ...TEST, skip: NO_CHROME }, async () => {
	const tmp = privateTmp();
	const { child, ready } = starter(`
		import { connectToPage, launchChrome } from "@apnex/headless-chromium";
		import fs from "node:fs";
		const chrome = await launchChrome();
		const page = await connectToPage(chrome.port);
		const made = fs.readdirSync(chrome.folder);
		page.send("Browser.close").catch(() => {});
		while (chrome.exited() === null) await new Promise((resolve) => setTimeout(resolve, 25));
		process.stdout.write("ready " + JSON.stringify({ made, exited: chrome.exited(), folder: chrome.folder }) + "\\n");
		setInterval(() => {}, 1000);
	`, { TMPDIR: tmp });
	try {
		const { made, exited, folder } = await ready;
		assert.ok(made.includes("profile") && made.some((name) => /^\.?com\.google\.Chrome\./.test(name)), `control: Chrome made its profile and lock folder: ${made}`);
		assert.notEqual(exited, null, "control: Chrome has exited before its starter is killed");
		assert.ok(fs.existsSync(folder), "control: the launch folder is still there");
		await killedLeavesNothing(child, tmp, "Chrome closed, then its starter killed");
	} finally {
		child.kill("SIGKILL");
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("HC1: a Chrome that crashed before its starter is killed still has its launch folder removed, its crash report with it, none written to the user's own", { ...TEST, skip: NO_CHROME }, async () => {
	const tmp = privateTmp();
	const reports = userCrashReports();
	const { child, ready } = starter(`
		import { launchChrome } from "@apnex/headless-chromium";
		import fs from "node:fs";
		const chrome = await launchChrome();
		const main = fs.readdirSync("/proc").filter((e) => /^\\d+$/.test(e)).find((pid) => {
			try {
				const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
				return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) === chrome.pid;
			} catch {
				return false;
			}
		});
		process.kill(Number(main), "SIGSEGV");
		while (chrome.exited() === null) await new Promise((resolve) => setTimeout(resolve, 25));
		let dumps = [];
		for (let i = 0; i < 100 && dumps.length === 0; i++, await new Promise((resolve) => setTimeout(resolve, 50))) dumps = fs.readdirSync(chrome.folder, { recursive: true }).filter((name) => name.endsWith(".dmp"));
		process.stdout.write("ready " + JSON.stringify({ exited: chrome.exited(), folder: chrome.folder, dumps }) + "\\n");
		setInterval(() => {}, 1000);
	`, { TMPDIR: tmp }, { coreless: true });
	try {
		const { exited, folder, dumps } = await ready;
		assert.deepEqual(exited, { code: 139, signal: null }, "control: Chrome crashed, and its tether ended with 139 rather than dumping a core of its own");
		assert.ok(dumps.length >= 1, `control: Chrome's crash reporter wrote its report, in the launch folder: ${dumps}`);
		assert.ok(fs.existsSync(folder), "control: the launch folder is still there");
		assert.equal(userCrashReports(), reports, "no report, and no settings, written to the user's own crash reports");
		await killedLeavesNothing(child, tmp, "Chrome crashed, then its starter killed");
	} finally {
		child.kill("SIGKILL");
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("HC1: dumpDom's starter killed the moment its Chrome has exited leaves nothing", TEST, async () => {
	for (let trial = 0; trial < 3; trial++) {
		const tmp = privateTmp();
		const mark = path.join(scratchFolder("cl-mark-"), "ended");
		const { child, ready } = starter(`
			import { dumpDom } from "@apnex/headless-chromium";
			process.stdout.write("ready {}\\n");
			await dumpDom("http://127.0.0.1:9/page", { chrome: ${JSON.stringify(FAKE_CHROME)} });
			setInterval(() => {}, 1000);
		`, { TMPDIR: tmp, FAKE_CHROME_MODE: "dump", FAKE_CHROME_MARK: mark });
		try {
			await ready;
			assert.ok(await until(() => fs.existsSync(mark), 10000), "control: the fake Chrome ran and exited");
			await killedLeavesNothing(child, tmp, `trial ${trial}: killed as Chrome exited`);
		} finally {
			child.kill("SIGKILL");
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	}
});

test("HC1: a starter killed at any moment of launchChrome or of dumpDom -- before the launch folder exists, while Chrome starts, runs or exits -- leaves nothing", { ...TEST, timeout: 120000, skip: NO_CHROME }, async () => {
	const delays = [0, 0, 5, 10, 20, 40, 80, 160, 320];
	for (const [index, delay] of delays.entries()) {
		for (const call of ["launchChrome()", 'dumpDom("about:blank", { virtualTimeBudgetMs: 100 })']) {
			const tmp = privateTmp();
			const { child, ready } = starter(`
				import { dumpDom, launchChrome } from "@apnex/headless-chromium";
				process.stdout.write("ready {}\\n");
				for (;;) await ${call};
			`, { TMPDIR: tmp });
			try {
				await ready;
				await sleep(delay);
				await killedLeavesNothing(child, tmp, `${index}: ${call} killed ${delay} ms in`);
			} finally {
				child.kill("SIGKILL");
				fs.rmSync(tmp, { recursive: true, force: true });
			}
		}
	}
});

test("HC1: a launch folder its Chrome's close has removed is taken back from the warden, so whatever later stands at its path outlives the starter", TEST, async () => {
	const tmp = privateTmp();
	const { child, ready } = starter(`
		import { launchChrome } from "@apnex/headless-chromium";
		import fs from "node:fs";
		const chrome = await launchChrome();
		await chrome.close();
		const gone = !fs.existsSync(chrome.folder);
		fs.mkdirSync(chrome.folder);
		fs.writeFileSync(chrome.folder + "/another's", "kept");
		process.stdout.write("ready " + JSON.stringify({ gone, folder: chrome.folder }) + "\\n");
		setInterval(() => {}, 1000);
	`, { TMPDIR: tmp, CHROME: FAKE_CHROME });
	try {
		const { gone, folder } = await ready;
		assert.equal(gone, true, "control: close removed the launch folder");
		child.kill("SIGKILL");
		await exitOf(child);
		assert.ok(await until(() => processesNaming(tmp).length === 0, 10000), "control: the starter's warden has done its work and ended");
		assert.equal(fs.readFileSync(path.join(folder, "another's"), "utf8"), "kept", "what came to stand at the path is left alone");
	} finally {
		child.kill("SIGKILL");
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("HC1: lockSocketWarning warns of a temporary folder whose launch folder's lock socket would be 108 characters, and not of one at 107, naming the longest that fits", () => {
	// a launch folder, the lock folder and the socket, beneath the temporary folder
	const suffix = "/ch-XXXXXX/.com.google.Chrome.XXXXXX/SingletonSocket".length;
	const folderOf = (length) => `/${"a".repeat(length - 1)}`;
	const fits = folderOf(107 - suffix);
	const over = folderOf(108 - suffix);
	assert.equal(lockSocketWarning(fits), null, "107 characters fit");
	assert.equal(lockSocketWarning(over), `the temporary folder ${over} is too long for Chrome's lock socket (108 > 107 characters): a Chrome launched in it will not start; use a TMPDIR at most ${fits.length} characters long`, "108 do not");
	assert.equal(lockSocketWarning(), lockSocketWarning(os.tmpdir()), "the temporary folder by default");
	assert.equal(lockSocketWarning(), null, "control: this run's temporary folder fits");
});

test("HC1: isLockFolderName knows the lock folder Chrome makes in either spelling, and nothing else", () => {
	assert.equal(isLockFolderName(".com.google.Chrome.Ab12Cd"), true, "with the leading dot, as Chrome 136 names it");
	assert.equal(isLockFolderName("com.google.Chrome.Ab12Cd"), true, "without it, as a later Chrome names it");
	for (const name of ["xcom.google.Chrome.Ab12Cd", "..com.google.Chrome.Ab12Cd", "com.google.Chrome.Ab12C", "com.google.Chrome.Ab12Cd7", "com.google.Chrome.Ab-2Cd", "cr-run-Ab12Cd"]) assert.equal(isLockFolderName(name), false, name);
});

test("HC1: a test that ends with its Chrome running fails its run under clean-runner's runner, which names the test and the Chrome; nothing of it survives", { ...TEST, skip: NO_CHROME }, async () => {
	const runner = spawnTethered(process.execPath, [CLI, "run", "--settle-ms=3000", PLANTED("leaves-chrome.mjs")], { cwd: ROOT, env: { ...process.env, TMPDIR: runnerBase(), CLEAN_RUNNER_RUN: "" }, stdio: ["ignore", "pipe", "pipe"] });
	let out = "";
	runner.stdout.on("data", (chunk) => (out += chunk));
	runner.stderr.on("data", (chunk) => (out += chunk));
	const code = await new Promise((resolve) => runner.on("close", (exitCode) => resolve(exitCode)));
	const [, pid, folder] = out.match(/planted chrome (\d+) (\S+)/) ?? [];
	assert.ok(folder, `control: the planted test launched Chrome: ${out}`);
	assert.equal(code, 1, out);
	assert.match(out, new RegExp(`^ {2}a process a tether had to stop -- \\S*test/fixtures/planted/leaves-chrome\\.mjs \\(pid \\d+\\) ended with \`\\S*chrome\\S* --headless=new .*\` still running; its tether stopped it$`, "m"));
	assert.equal(fs.existsSync(folder), false, "the Chrome's launch folder is gone");
	assert.equal(running(Number(pid)), false, "the Chrome's tether is gone");
	assert.deepEqual(processesNaming(folder), [], "no process of that Chrome is running");
});
