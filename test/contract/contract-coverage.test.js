// contract-coverage - one test file per row of CONTRACT.md's capability table, so the contract reads as a list of
// tests; and CONTRACT.md carries a component entry's six headings, its rules and its invariants.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { contractRows } from "../../tools/check-export-map.mjs";
import { ROOT } from "../support/helpers.js";

const text = fs.readFileSync(path.join(ROOT, "CONTRACT.md"), "utf8");
const rows = contractRows(text);

test("CONTRACT.md has its four capabilities", () => {
	assert.deepEqual(rows, ["chrome-launch", "devtools-session", "trusted-input", "static-server"]);
});

for (const row of rows) {
	test(`${row} has its contract test file`, () => {
		assert.ok(fs.existsSync(path.join(ROOT, "test", "contract", `${row}.test.js`)), `test/contract/${row}.test.js is missing`);
	});
}

test("CONTRACT.md carries the six headings of a component entry, in order, and its frontmatter", () => {
	const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
	assert.deepEqual(headings, ["Duty", "Contract", "Reference", "Fit criteria", "Adjustment policy", "Edges"]);
	for (const field of ["id: unminted", "category: component", "status: draft", "sovereignty: internal", "supersedes: []", "related: [C0, A3]"]) {
		assert.ok(text.includes(`\n${field}\n`), `the frontmatter holds ${field}`);
	}
});

test("CONTRACT.md states every rule, HC1 to HC5, and every invariant, I1 to I10, and each rule names the tests that hold it", () => {
	for (let n = 1; n <= 5; n++) assert.match(text, new RegExp(`\\*\\*HC${n} -- [^*]+\\.\\*\\*`), `HC${n}`);
	for (let n = 1; n <= 10; n++) assert.match(text, new RegExp(`^\\| I${n} \\|`, "m"), `I${n}`);
	const rules = text.split(/^\*\*HC\d -- /m).slice(1);
	assert.equal(rules.length, 5);
	assert.doesNotMatch(text, /^\| I11 \|/m, "and no eleventh invariant");
	for (const [index, rule] of rules.entries()) assert.match(rule.split(/^\*\*/m)[0], /^Tested by: /m, `HC${index + 1} names its tests`);
});

test("every test file a rule or an invariant names exists", () => {
	const named = new Set([...text.matchAll(/`((?:test|tools)\/[^`]+\.(?:js|mjs|mts))`/g)].map((m) => m[1]));
	assert.ok(named.size >= 10, `${named.size} files named`);
	for (const file of named) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
});

test("each contract test file says which rule it holds", () => {
	const holds = { "chrome-launch": "HC1", "devtools-session": "HC2", "trusted-input": "HC3", "static-server": "HC4" };
	for (const [row, rule] of Object.entries(holds)) {
		const source = fs.readFileSync(path.join(ROOT, "test", "contract", `${row}.test.js`), "utf8");
		const labels = [...source.matchAll(/^(?:\t)?test\(\s*[`"]([^`"]+)[`"]/gm)].map((m) => m[1]);
		assert.ok(labels.length > 0, row);
		for (const label of labels) assert.ok(label.startsWith(`${rule}: `), `${row}: "${label}" begins with ${rule}`);
	}
});

test("CONTRACT.md names nothing of draw's but its one provenance line", () => {
	const naming = text.split("\n").filter((line) => /drawv2|draw's|H26/.test(line));
	assert.equal(naming.length, 1, naming.join("\n"));
	assert.match(naming[0], /^It was built under draw's ruling `H26-19` as amended, which is kept in draw's records, `apnex\/drawv2`\.$/);
});
