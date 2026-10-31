#!/usr/bin/env node
// check-style - runs mission-kit's style checks (S6, S8, S10, S12, S13) over the repository's Markdown.
//
// The checks are fetched, never copied (as the four components fetch them): CI checks out
// apnex/mission-kit at HEAD and points MISSION_KIT at it; a developer's machine uses a sibling checkout,
// ../mission-kit. A run that cannot find the tools fails rather than skips, because a rule that is not
// run has not passed. An upstream change can turn the gate red with no commit here; that is the ruling
// working, and the tools' directory is named on every run so the cause is found at once.
//
// The files are those git would keep: tracked, and untracked but not ignored, so a new document is
// checked before its first commit.
//
// Usage:  node tools/check-style.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [process.env.MISSION_KIT, path.resolve(root, "..", "mission-kit")].filter(Boolean);
const kit = candidates.find((d) => fs.existsSync(path.join(d, "tools", "s13-plain-ascii.sh")));
if (!kit) {
	console.log("check-style: FAIL -- no mission-kit checkout found. Looked in:");
	for (const c of candidates) console.log(`  ${c}`);
	console.log("Set MISSION_KIT, or clone https://github.com/apnex/mission-kit.git beside this repository.");
	process.exit(1);
}

const docs = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"], { cwd: root, encoding: "utf8" })
	.split("\n")
	.filter((f) => f && fs.existsSync(path.join(root, f)))
	.sort();
if (docs.length === 0) {
	console.log("check-style: FAIL -- no Markdown found, so nothing was checked");
	process.exit(1);
}

const rules = [
	["S6", "node", [path.join(kit, "tools", "s6-one-sentence-per-line.mjs"), "--check"]],
	["S8", "bash", [path.join(kit, "tools", "s8-code-block-comments.sh")]],
	["S10", "bash", [path.join(kit, "tools", "s10-section-rules.sh")]],
	["S12", "bash", [path.join(kit, "tools", "s12-code-block-introducer.sh")]],
	["S13", "bash", [path.join(kit, "tools", "s13-plain-ascii.sh")]],
];
let failed = 0;
for (const [rule, bin, args] of rules) {
	let out = "", ok = true;
	try {
		out = execFileSync(bin, [...args, ...docs], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		ok = false;
		out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
	}
	const findings = out.split("\n").filter((l) => /FAIL|^\S+:\d+/.test(l));
	if (ok && findings.length === 0) continue;
	failed++;
	console.log(`  ${rule}: ${findings.length || "a non-zero exit and"} finding(s)`);
	for (const f of (findings.length ? findings : out.split("\n")).slice(0, 20)) console.log(`    ${f.trim()}`);
}
console.log(`check-style: ${docs.length} document(s) against S6, S8, S10, S12 and S13, tools at ${kit}`);
if (failed) {
	console.log(`check-style: FAIL -- ${failed} rule(s) with findings; most tools carry a --fix, run them directly`);
	process.exit(1);
}
console.log("check-style: PASS");
