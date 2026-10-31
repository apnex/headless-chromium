// gate-checks - the gate's own checks (I6) can fail: the vocabulary, source, runtime and public-text checks each pass
// over this repository and fail over a copy, or a text, holding what they exist to refuse.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { findHexIdentifiers, isWorkflowFile } from "../../tools/check-public-text.mjs";
import { ALLOWED_GLOBALS, findRuntimeUses, freeGlobalReferences, isBuiltinModule, parseModule } from "../../tools/check-runtime.mjs";
import { findConfigProblems, findSourceProblems, RUNTIME_TYPES, sourceProblems } from "../../tools/check-source.mjs";
import { candidateWords, findVocabulary, readVocabulary, splitWords } from "../../tools/check-vocabulary.mjs";
import { ROOT, scratchCopy } from "../support/helpers.js";

const run = (tool, ...args) => spawnSync(process.execPath, [path.join(ROOT, "tools", tool), ...args], { cwd: ROOT, encoding: "utf8" });
const vocabulary = readVocabulary();

test("I6: the vocabulary check passes over src, with no text allowed by name", () => {
	const out = run("check-vocabulary.mjs");
	assert.equal(out.status, 0, out.stdout);
	assert.match(out.stdout, /^check-vocabulary: PASS -- 6 file\(s\), no word of draw or input-tester's vocabulary but the 0 text\(s\) allowed by name$/m);
	assert.deepEqual(vocabulary.allowed, []);
	for (const { text, file } of vocabulary.allowed) assert.ok(fs.readFileSync(path.join(ROOT, file), "utf8").includes(text), `${text} is in ${file}, where it is allowed`);
});

test("I6: the vocabulary check splits identifiers and compares each whole; draw's traps for this component -- node:, the runtime's name, pipe, symbolic links, spawner -- are caught", () => {
	assert.deepEqual(splitWords("nodeCount NODE_EXT isSymbolicLink"), ["node", "count", "node", "ext", "is", "symbolic", "link"]);
	assert.deepEqual(candidateWords("draw_V2"), ["draw_v2", "drawv2", "draw", "v", "2"]);
	const caught = (text, file = "src/x.ts") => findVocabulary(text, vocabulary, file).map((f) => f.listed);
	assert.deepEqual(caught('import fs from "node:fs";'), ["node"]);
	assert.deepEqual(caught("// the runtime, Node.js, and Node's runner"), ["node", "node"]);
	assert.deepEqual(caught('spawn(cmd, args, { stdio: "pipe" });'), ["pipe"]);
	assert.deepEqual(caught("// a spawner holds the pipes; the profile's link"), ["spawner", "pipe", "link"]);
	assert.deepEqual(caught("if (stat.isSymbolicLink()) return;"), ["link"], "a method allowed in one file is caught in another");
	const allowing = { ...vocabulary, allowed: [{ text: "isSymbolicLink", file: "src/folder.ts", why: "this test's own" }] };
	assert.deepEqual(findVocabulary("if (stat.isSymbolicLink()) return;", allowing, "src/folder.ts").map((f) => f.listed), [], "and allowed, by its exact text, in the one file named");
	assert.deepEqual(findVocabulary("if (stat.isSymbolicLink()) return;", allowing, "src/other.ts").map((f) => f.listed), ["link"], "and in that file alone");
	assert.deepEqual(caught("delete env.NODE_TEST_CONTEXT;", "src/cli.ts"), ["node"]);
	assert.deepEqual(caught("#!/usr/bin/env node", "src/test-run.ts"), ["node"]);
	assert.deepEqual(caught("const keyboardLayout = 1;"), ["keyboard", "layout"]);
	assert.deepEqual(caught("// a symlink is removed itself; readlinkSync, symlinkSync, spawned, process.execPath"), [], "words that merely contain a listed one pass");
});

test("I6: the vocabulary check fails on a word of draw's planted in a copy of src", () => {
	const copy = scratchCopy(["src"]);
	fs.appendFileSync(path.join(copy, "src", "static-server.ts"), "\n// each anchor of the page\n");
	const out = run("check-vocabulary.mjs", path.join(copy, "src"));
	assert.equal(out.status, 1, out.stdout);
	assert.match(out.stdout, /static-server\.ts:\d+ {2}"anchor" \(draw: anchor\)/);
});

test("I6: the source check passes over this repository, its types the runtime's alone", () => {
	assert.deepEqual(sourceProblems(ROOT), []);
	assert.deepEqual(RUNTIME_TYPES, ["node"]);
});

test("I6: the source check fails on a declare form, a triple-slash directive -- after a template literal too -- and a file that is no module", () => {
	const problems = (source) => findSourceProblems(source, "planted.ts").map((p) => p.finding);
	assert.deepEqual(problems("export {};\ndeclare const window: any;"), ["declares with `declare` (const)"]);
	assert.deepEqual(problems("export {};\ndeclare global { var x: number }"), ["declares with `declare` (global)"]);
	assert.deepEqual(problems('/// <reference lib="dom" />\nexport {};'), ['holds a triple-slash reference to the lib "dom"']);
	assert.deepEqual(problems('export const t = `a${1}b`;\n/// <reference lib="dom" />'), ["holds a comment of a triple-slash directive's form"]);
	assert.deepEqual(problems("const x = 1;"), ["is no ES module, so its top-level declarations would be globals"]);
	assert.deepEqual(problems("export const y = 2;"), [], "control");
});

test("I6: the source check fails on tsconfig settings that would bring another library in, and on a copy of src planting one", () => {
	const base = JSON.parse(fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8"));
	assert.deepEqual(findConfigProblems(base), []);
	const changed = (edit) => findConfigProblems(edit(structuredClone(base)));
	assert.deepEqual(changed((c) => ((c.compilerOptions.types = []), c)), ['compilerOptions.types is [], not ["node"]']);
	assert.deepEqual(changed((c) => ((c.compilerOptions.types = ["node", "ws"]), c)), ['compilerOptions.types is ["node","ws"], not ["node"]']);
	assert.deepEqual(changed((c) => ((c.compilerOptions.lib = ["ES2022", "DOM"]), c)), ['compilerOptions.lib is ["ES2022","DOM"], not ["ES2022"]']);
	assert.deepEqual(changed((c) => ((c.include = ["src", "test"]), c)), ['include is ["src","test"], not ["src"]']);
	const copy = scratchCopy(["src", "tsconfig.json", "package.json"]);
	fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(copy, "node_modules"), "dir");
	const planted = path.join(copy, "src", "chrome-folders.ts");
	fs.writeFileSync(planted, `/// <reference lib="dom" />\n${fs.readFileSync(planted, "utf8")}`);
	const found = sourceProblems(copy);
	assert.ok(found.some((p) => /^src\/chrome-folders\.ts:\d+: holds a triple-slash reference to the lib "dom"$/.test(p)), found.join("\n"));
	assert.ok(found.some((p) => /the program compiles lib\.dom\.d\.ts, a platform library/.test(p)), found.join("\n"));
});

test("I6: the runtime check passes over dist, its allowed globals exactly those the built files name", () => {
	const out = run("check-runtime.mjs");
	assert.equal(out.status, 0, out.stdout);
	const dist = path.join(ROOT, "dist");
	const named = new Set();
	for (const file of fs.readdirSync(dist).filter((f) => f.endsWith(".js"))) for (const { name } of freeGlobalReferences(parseModule(fs.readFileSync(path.join(dist, file), "utf8"), file))) named.add(name);
	assert.deepEqual([...named].sort(), [...ALLOWED_GLOBALS].sort(), "no global allowed that the build does not use, and none used that is not allowed");
});

test("I6: the runtime check allows relative files and built-in modules under either spelling, allows the runtime dependency by its bare name alone, and fails on another package, a dynamic import, eval, Function, globalThis, require, a constructor call and a global the build does not use", () => {
	const findings = (source) => findRuntimeUses(source, "planted.js").map((f) => f.finding);
	assert.deepEqual(findings('import * as fs from "fs";\nimport { spawn } from "node:child_process";\nimport { a } from "./a.js";\nimport * as p from "fs/promises";\nexport { b } from "../b.js";'), [], "control");
	assert.equal(isBuiltinModule("node:fs"), true);
	assert.equal(isBuiltinModule("fs"), true);
	assert.equal(isBuiltinModule("ws"), false);
	assert.deepEqual(findings('import { spawnTethered } from "@apnex/clean-runner";'), [], "the runtime dependency, by its bare name");
	assert.deepEqual(findings('import { wardenForgets } from "@apnex/clean-runner/dist/tethered-process.js";'), ['imports "@apnex/clean-runner/dist/tethered-process.js", which is neither a relative file, a built-in module nor a runtime dependency by its bare name'], "and never a path into it");
	assert.deepEqual(findings('import WebSocket from "ws";'), ['imports "ws", which is neither a relative file, a built-in module nor a runtime dependency by its bare name']);
	assert.deepEqual(findings('import x from "node:no-such-module";'), ['imports "node:no-such-module", which is neither a relative file, a built-in module nor a runtime dependency by its bare name']);
	assert.deepEqual(findings('export const m = import("./a.js");'), ["holds a dynamic import("]);
	assert.deepEqual(findings('export const v = eval("1");'), ["names eval"]);
	assert.deepEqual(findings("export const g = globalThis;"), ["names globalThis"]);
	assert.deepEqual(findings('export const r = require("fs");'), ["names require"]);
	assert.deepEqual(findings('export const f = new Function("return 1");'), ["names Function"]);
	assert.deepEqual(findings('export const h = (() => 1).constructor("return this")();'), ["calls through a property named constructor, which reaches Function"]);
	assert.deepEqual(findings("export const a = Atomics;"), ["names the global Atomics, which is none of the globals the build uses"]);
	assert.deepEqual(findings('// eval("x"), require, globalThis\nexport const s = "eval require globalThis";\nexport const q = s.require;'), [], "names in comments, strings and members are not uses");
	assert.deepEqual(findings("export const o = { eval: 1 };"), ["names eval"], "an object literal's key is counted, as the components' check counts it");
});

test("I6: the runtime check fails on a package import planted in a copy of the built files", () => {
	const copy = scratchCopy(["dist"]);
	fs.appendFileSync(path.join(copy, "dist", "static-server.js"), '\nimport "left-pad";\n');
	const out = run("check-runtime.mjs", path.join(copy, "dist"));
	assert.equal(out.status, 1, out.stdout);
	assert.match(out.stdout, /static-server\.js:\d+ {2}imports "left-pad", which is neither a relative file, a built-in module nor a runtime dependency by its bare name/);
});

test("I6: the public-text check passes here, and finds sixteen hex digits anywhere but an action's pin in a workflow's uses line", () => {
	const out = run("check-public-text.mjs");
	assert.equal(out.status, 0, out.stdout);
	// the runs are made at run time, so this file holds none itself
	const hex = ["01234567", "89abcdef"].join("");
	assert.deepEqual(findHexIdentifiers(`an id ${hex} here`), [{ line: 1, text: "0123...(16 hex digits)" }]);
	assert.deepEqual(findHexIdentifiers(`short ${hex.slice(1)} here`), [], "fifteen is no identifier");
	const commit = [hex, hex, "01234567"].join("");
	const pin = `      - uses: actions/checkout@${commit} # v4.4.0`;
	assert.deepEqual(findHexIdentifiers(pin, { workflow: true }), [], "an action's pin in a workflow");
	assert.equal(findHexIdentifiers(pin).length, 1, "the same line elsewhere is found");
	assert.equal(findHexIdentifiers(`      run: echo ${commit}`, { workflow: true }).length, 1, "and in a workflow's other lines");
	assert.equal(findHexIdentifiers(`      - uses: actions/checkout@${commit}0`, { workflow: true }).length, 1, "a pin of 41 hex digits is no commit");
	assert.equal(isWorkflowFile(".github/workflows/gate.yml"), true);
	assert.equal(isWorkflowFile("docs/gate.yml"), false);
});
