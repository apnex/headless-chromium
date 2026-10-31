// public-types - I5 (CONTRACT.md HC5): headless-chromium's published types, compiled from a consumer in test/types/ with
// tsc --noEmit under strict settings, with and without exactOptionalPropertyTypes, against the runtime's types a
// consumer's tests compile against. Each expected-error line must fail to compile, or tsc reports the directive unused;
// and, compiled again with the directives taken out, each must fail on its own line and no other line may, so no
// expected error passes for a reason other than its own.
//
// tsc enables the runtime's compile cache in its temporary folder, which under a run is the run folder; the run would
// rightly fail on the cache left there, so tsc is run here with the cache turned off.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { scratchFolder } from "@apnex/clean-runner";
import { ROOT } from "../support/helpers.js";

const tsc = path.join(ROOT, "node_modules", ".bin", "tsc");
const consumer = path.join(ROOT, "test", "types", "headless-chromium-consumer.mts");
const flags = ["--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--lib", "ES2022", "--types", "node", "--skipLibCheck", "false"];
const MODES = [["strict", []], ["strict, exactOptionalPropertyTypes", ["--exactOptionalPropertyTypes"]]];
const DIRECTIVE = /^\s*\/\/ @ts-expect-error -- (.*)$/;
const TEST = { timeout: 60000 };

/** tsc over a file: its diagnostics' output, empty when it compiles. */
function compile(file, extra, cwd) {
	try {
		execFileSync(tsc, [...extra, ...flags, file], { cwd, encoding: "utf8", stdio: "pipe", env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" } });
		return "";
	} catch (e) {
		return `${e.stdout}${e.stderr}`;
	}
}

for (const [label, extra] of MODES) {
	test(`I5: a consumer type-checks against the public entry point, every expected error failing (${label})`, TEST, () => {
		const output = compile(consumer, extra, ROOT);
		assert.equal(output, "", `the consumer does not compile:\n${output}`);
	});
}

test("I5: the consumer uses every export, and holds the expected errors I5 names", () => {
	const source = fs.readFileSync(consumer, "utf8");
	const reasons = source.split("\n").flatMap((line) => DIRECTIVE.exec(line)?.[1] ?? []);
	for (const needed of ["a mouse event type the protocol has no such name for", "the params made are read-only", "the button names are read-only", "a Chrome's port is read-only", "lockSocketWarning answers a warning or null"]) assert.ok(reasons.includes(needed), needed);
	for (const name of ["BUTTON_BITS", "BUTTON_NAMES", "connectToPage", "dumpDom", "findChrome", "heldButtonName", "isLockFolderName", "launchChrome", "lockSocketWarning", "loseFocus", "mouseEventParams", "serveStatic"]) assert.match(source, new RegExp(`\\b${name}\\(|\\b${name}\\[`), name);
});

for (const [label, extra] of MODES) {
	test(`I5: with the directives taken out, each expected error fails on its own line and nothing else fails (${label})`, TEST, () => {
		const lines = fs.readFileSync(consumer, "utf8").split("\n");
		const expected = [];
		const stripped = lines.map((line, index) => {
			if (!DIRECTIVE.test(line)) return line;
			expected.push(index + 2);
			return "";
		});
		const dir = scratchFolder("types-");
		fs.mkdirSync(path.join(dir, "node_modules", "@apnex"), { recursive: true });
		fs.symlinkSync(ROOT, path.join(dir, "node_modules", "@apnex", "headless-chromium"), "dir");
		fs.symlinkSync(path.join(ROOT, "node_modules", "@apnex", "clean-runner"), path.join(dir, "node_modules", "@apnex", "clean-runner"), "dir");
		fs.symlinkSync(path.join(ROOT, "node_modules", "@types"), path.join(dir, "node_modules", "@types"), "dir");
		fs.symlinkSync(path.join(ROOT, "node_modules", "undici-types"), path.join(dir, "node_modules", "undici-types"), "dir");
		fs.writeFileSync(path.join(dir, "consumer.mts"), stripped.join("\n"));
		const output = compile("consumer.mts", extra, dir);
		const failing = [...output.matchAll(/^consumer\.mts\((\d+),\d+\): error/gm)].map((match) => Number(match[1]));
		assert.deepEqual([...new Set(failing)], expected, output);
		assert.equal(expected.length, 11, `${expected.length} expected errors`);
	});
}
