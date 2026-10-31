#!/usr/bin/env node
// consumer-test - the consumer test (the four components', adapted; CONTRACT.md HC5): the package as a project
// receives it.
//
// It packs the package -- or takes a tarball already packed, such as the one a release attaches -- checks that it holds
// the built files and the documents alone, installs the file into an empty project as a development dependency, as a
// project takes it, and finds that clean-runner, its one runtime dependency, alone came with it; imports every export
// by name; and, under the installed `clean-runner exec`, serves a page with the installed package, drives it in
// headless Chrome with a session, trusted input and a focus loss, and loads it again with dumpDom, leaving nothing
// behind.
//
// Chrome is $CHROME, or google-chrome on PATH. The scratch folder is removed at the end, a folder that cannot be
// removed being a warning, never a failure. Nothing here needs an npm dependency.
//
// Usage:  node tools/consumer-test.mjs [--tarball FILE] [--keep]    (or HEADLESS_CHROMIUM_TARBALL=FILE)
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keep = process.argv.includes("--keep");
const tarballAt = process.argv.indexOf("--tarball");
const given = tarballAt > -1 ? process.argv[tarballAt + 1] : process.env.HEADLESS_CHROMIUM_TARBALL || null;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "headless-chromium-consumer-"));
const fail = (message) => {
	console.log(`consumer-test: FAIL -- ${message}`);
	process.exitCode = 1;
	throw new Error(message);
};
const step = (message) => console.log(`  ${message}`);

/** Runs a command in the project, answering its exit code and everything it wrote. */
function inProject(project, command, args) {
	const out = spawnSync(command, args, { cwd: project, encoding: "utf8", timeout: 170000, killSignal: "SIGKILL", env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" } });
	return { code: out.status, text: `${out.stdout ?? ""}${out.stderr ?? ""}` };
}

/** The script that drives Chrome through the installed package. */
const DRIVE_CHROME = `import { connectToPage, dumpDom, launchChrome, loseFocus, mouseEventParams, serveStatic } from "@apnex/headless-chromium";

const page = '<!doctype html><title>consumer</title><body style="margin:0"><div id="pad" style="width:300px;height:200px"></div><script>' +
	'window.seen = []; addEventListener("blur", () => seen.push("blur"));' +
	'const pad = document.getElementById("pad"); pad.addEventListener("pointerdown", (e) => pad.setPointerCapture(e.pointerId));' +
	'pad.addEventListener("pointermove", (e) => seen.push("move " + e.buttons + " " + pad.hasPointerCapture(e.pointerId)));' +
	'document.title = "consumer-ok";</script>';
const server = await serveStatic({ pages: { "/": page } });
const chrome = await launchChrome();
const session = await connectToPage(chrome.port);
try {
	await session.send("Page.navigate", { url: server.origin + "/" });
	for (let i = 0; i < 200 && (await session.evaluate("document.title")) !== "consumer-ok"; i++) await new Promise((r) => setTimeout(r, 25));
	await session.send("Input.dispatchMouseEvent", mouseEventParams("mouseMoved", { x: 20, y: 20 }));
	await session.send("Input.dispatchMouseEvent", mouseEventParams("mousePressed", { x: 20, y: 20 }, { button: "left", buttons: 1 }));
	await session.send("Input.dispatchMouseEvent", mouseEventParams("mouseMoved", { x: 60, y: 20 }, { buttons: 1 }));
	await session.send("Input.dispatchMouseEvent", mouseEventParams("mouseReleased", { x: 60, y: 20 }, { button: "left" }));
	await loseFocus(session);
	const seen = await session.evaluate("seen.join(',')");
	if (seen !== "move 0 false,move 1 true,blur") throw new Error("the page saw " + seen);
	const dom = await dumpDom(server.origin + "/", { virtualTimeBudgetMs: 2000 });
	if (!dom.includes("<title>consumer-ok</title>")) throw new Error("dumpDom answered " + dom.slice(0, 200));
	console.log("chrome-ok " + seen);
} finally {
	session.close();
	await chrome.close();
	await server.close();
}
`;

async function main() {
	// 1. the tarball given, or build and pack one, as a release does
	let tarball, shipped;
	if (given) {
		tarball = path.resolve(given);
		if (!fs.existsSync(tarball) || !fs.statSync(tarball).isFile()) fail(`no tarball at ${tarball}`);
		const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter((e) => e && !e.endsWith("/"));
		if (entries.some((e) => !e.startsWith("package/"))) fail(`${tarball} is not an npm package tarball`);
		shipped = entries.map((e) => e.slice("package/".length)).sort();
		step(`took the tarball given, ${path.basename(tarball)}: ${shipped.length} files`);
	} else {
		execFileSync("npm", ["run", "build"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
		const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
		tarball = path.join(scratch, packed[0].filename);
		shipped = packed[0].files.map((f) => f.path).sort();
		step(`packed ${packed[0].filename}: ${shipped.length} files`);
	}
	const stray = shipped.filter((f) => !f.startsWith("dist/") && !["CONTRACT.md", "LICENSE", "README.md", "VISION.md", "package.json"].includes(f));
	if (stray.length) fail(`the tarball holds files outside dist and the documents: ${stray.join(", ")}`);
	for (const needed of ["dist/index.js", "dist/index.d.ts", "dist/chrome-launch.js", "dist/chrome-folders.js"]) if (!shipped.includes(needed)) fail(`the tarball lacks ${needed}`);

	// 2. install the file into an empty project, without development dependencies
	const project = path.join(scratch, "project");
	fs.mkdirSync(path.join(project, "test"), { recursive: true });
	fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "headless-chromium-consumer", version: "0.0.0", private: true, type: "module" }, null, 2));
	execFileSync("npm", ["install", tarball, "--save-dev", "--no-audit", "--no-fund"], { cwd: project, stdio: ["ignore", "ignore", "inherit"] });
	const installed = path.join(project, "node_modules", "@apnex", "headless-chromium");
	const pkg = JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8"));
	const others = fs.readdirSync(path.join(project, "node_modules")).filter((d) => d !== "@apnex" && !d.startsWith("."));
	if (others.length) fail(`installing brought other packages: ${others.join(", ")}`);
	const scoped = fs.readdirSync(path.join(project, "node_modules", "@apnex")).sort();
	if (JSON.stringify(scoped) !== JSON.stringify(["clean-runner", "headless-chromium"])) fail(`installing brought @apnex/${scoped.join(", @apnex/")}`);
	const runner = JSON.parse(fs.readFileSync(path.join(project, "node_modules", "@apnex", "clean-runner", "package.json"), "utf8"));
	step(`installed ${pkg.name}@${pkg.version} into an empty project, with ${runner.name}@${runner.version}, its one dependency, and nothing else`);

	// 3. import every export by name
	const map = JSON.parse(fs.readFileSync(path.join(root, "export-map.json"), "utf8"));
	const names = Object.keys(map.paths["."].exports);
	fs.writeFileSync(path.join(project, "imports.mjs"), `import { ${names.join(", ")} } from "${pkg.name}";\nconst all = { ${names.join(", ")} };\nfor (const [name, value] of Object.entries(all)) if (value === undefined) throw new Error(name + " is undefined");\nconsole.log("imports-ok " + Object.keys(all).sort().join(","));\n`);
	const imported = inProject(project, process.execPath, ["imports.mjs"]);
	if (imported.code !== 0 || !imported.text.startsWith("imports-ok ")) fail(`importing: ${imported.text}`);
	step(`Node.js ${process.version} imported all ${names.length} exports by name`);

	const bin = path.join(project, "node_modules", ".bin", "clean-runner");
	if (!fs.existsSync(bin)) fail("the install made no node_modules/.bin/clean-runner");

	// 4. Chrome, driven through the installed package, under the installed runner
	fs.writeFileSync(path.join(project, "drive-chrome.mjs"), DRIVE_CHROME);
	const driven = inProject(project, bin, ["exec", process.execPath, "drive-chrome.mjs"]);
	if (driven.code !== 0 || !/^chrome-ok /m.test(driven.text) || !/^clean-runner: nothing left behind/m.test(driven.text)) fail(`driving Chrome: exit ${driven.code}\n${driven.text}`);
	const { stdout: version } = spawnSync(process.env.CHROME || "google-chrome", ["--version"], { encoding: "utf8" });
	step(`${(version ?? "").trim() || "Chrome"} served, launched, driven with trusted input and a focus loss, and dumped through the installed package: ${driven.text.match(/^chrome-ok (.*)$/m)[1]}; nothing left behind`);
	console.log("consumer-test: PASS");
}

try {
	await main();
} catch (e) {
	if (!process.exitCode) {
		console.log(`consumer-test: FAIL -- ${e.message}`);
		process.exitCode = 1;
	}
} finally {
	if (!keep) {
		try {
			fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		} catch (error) {
			process.stderr.write(`consumer-test: warning: left the scratch folder ${scratch}: ${error?.message ?? error}\n`);
		}
	} else console.log(`  kept ${scratch}`);
}
