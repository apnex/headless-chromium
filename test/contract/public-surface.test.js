// public-surface - the package exposes exactly what export-map.json names (zorg's EM14; HC5), declares no runtime
// dependency but clean-runner, and runs its own tests under clean-runner's runner.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { contractRows, exportMapProblems } from "../../tools/check-export-map.mjs";
import { ROOT, scratchCopy } from "../support/helpers.js";

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const map = JSON.parse(fs.readFileSync(path.join(ROOT, "export-map.json"), "utf8"));

const EXPORTS = ["BUTTON_BITS", "BUTTON_NAMES", "connectToPage", "dumpDom", "findChrome", "heldButtonName", "isLockFolderName", "launchChrome", "lockSocketWarning", "loseFocus", "mouseEventParams", "serveStatic"];

test("HC5: the package exports exactly its twelve names from its one path, and no file by a subpath", async () => {
	assert.deepEqual(Object.keys(await import("@apnex/headless-chromium")).sort(), EXPORTS);
	assert.deepEqual(pkg.exports, { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } });
	await assert.rejects(import("@apnex/headless-chromium/dist/chrome-launch.js"), "no file is reachable by a subpath");
});

test("HC5: the export map names the package, its one path and every export, each serving its contract rows, nothing deferred", () => {
	assert.equal(map.package, pkg.name);
	assert.deepEqual(Object.keys(map.paths), ["."]);
	assert.deepEqual(Object.keys(map.paths["."].exports).sort(), EXPORTS);
	assert.deepEqual(map.deferred, {});
	const rows = contractRows(fs.readFileSync(path.join(ROOT, "CONTRACT.md"), "utf8"));
	const served = new Set(Object.values(map.paths["."].exports).flatMap((e) => e.serves));
	assert.deepEqual([...served].sort(), [...rows].sort(), "every row is served, and nothing else");
	for (const entry of Object.values(map.paths["."].exports)) assert.equal(entry.part, "headless-chromium");
});

test("HC5: the package is @apnex/headless-chromium 0.2.0, for the runtime's version 22.4 and later, its one runtime dependency clean-runner 0.2.0 pinned to its release file, its two development dependencies pinned exactly", () => {
	assert.equal(pkg.name, "@apnex/headless-chromium");
	assert.equal(pkg.version, "0.2.0");
	assert.equal(pkg.type, "module");
	assert.equal(pkg.license, "MIT");
	assert.deepEqual(pkg.engines, { node: ">=22.4" }, "the version from which the runtime holds a global WebSocket");
	assert.deepEqual(pkg.dependencies, { "@apnex/clean-runner": "https://github.com/apnex/clean-runner/releases/download/v0.2.0/apnex-clean-runner-0.2.0.tgz" });
	const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")).packages["node_modules/@apnex/clean-runner"];
	assert.equal(lock.version, "0.2.0");
	assert.match(lock.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, "the lockfile pins the release file by its hash");
	assert.equal(pkg.peerDependencies, undefined);
	assert.equal(pkg.optionalDependencies, undefined);
	assert.deepEqual(pkg.devDependencies, { "@types/node": "22.20.5", typescript: "5.9.3" });
	assert.equal(pkg.bin, undefined, "no command: the runner is clean-runner's");
	assert.deepEqual([...pkg.files].sort(), ["CONTRACT.md", "LICENSE", "README.md", "VISION.md", "dist"]);
	assert.equal(pkg.repository.url, "git+https://github.com/apnex/headless-chromium.git");
});

test("HC5: the repository's own tests run under clean-runner's runner, built first, and the gate runs them and every check", () => {
	assert.equal(pkg.scripts.test, 'npm run build && clean-runner run "test/**/*.test.js"', "the tests run under clean-runner's runner, given no --test-force-exit, which drops a file's reported results on the runtime's version 22");
	assert.equal(pkg.scripts.gate, "npm test && node tools/check-vocabulary.mjs && node tools/check-source.mjs && node tools/check-runtime.mjs && node tools/check-export-map.mjs && node tools/check-public-text.mjs && node tools/check-style.mjs");
	assert.ok(process.env.CLEAN_RUNNER_RUN, "and this file runs inside a run");
});

test("HC5: the export-map check passes here, and fails on a map naming an export the package lacks, a row the contract lacks, or missing a row", async () => {
	assert.deepEqual(await exportMapProblems(ROOT), []);
	const copy = scratchCopy(["package.json", "CONTRACT.md", "export-map.json", "docs/DECISIONS.md", "dist"]);
	// the built files import clean-runner, as the package does
	fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(copy, "node_modules"), "dir");
	const broken = structuredClone(map);
	broken.paths["."].exports.extraThing = { part: "headless-chromium", serves: ["chrome-launch"] };
	broken.paths["."].exports.serveStatic.serves = ["no-such-row"];
	fs.writeFileSync(path.join(copy, "export-map.json"), JSON.stringify(broken));
	const problems = await exportMapProblems(copy);
	assert.ok(problems.some((p) => p.startsWith(". exports") && p.includes("extraThing")), problems.join("\n"));
	assert.ok(problems.includes(". serveStatic serves no-such-row, which is no row of CONTRACT.md"), problems.join("\n"));
	assert.ok(problems.includes("static-server is neither served nor deferred"), problems.join("\n"));
});
