#!/usr/bin/env node
// check-vocabulary - the vocabulary check (the components' check, as input-tester widened it with allowed texts;
// CONTRACT.md I6): fails when a file of src/ holds a word of a consumer's vocabulary, in code, a string or a comment.
//
// Every run of letters, digits, underscores and hyphens is a candidate whole, lower-cased, and again with its
// underscores and hyphens removed, so drawV2 and draw_v2 are drawv2; and it is split at case changes, underscores,
// hyphens and between letters and digits -- so nodeCount is node and count, NODE_EXT is node and ext, zone2 is zone
// and 2 -- each part a candidate too. A candidate matches a listed word when it equals it, or equals it once a
// trailing "s" or "es" is removed, so zones and nodes match. A run of lower-case letters holding a listed word with
// no break inside it -- zonegrid, symlink -- cannot be split without a dictionary, and is not caught.
//
// The lists are test data, kept here and never in src/ or a release. A text headless-chromium genuinely needs -- the
// runtime's own name for something -- is allowed by its exact text, in the one file consumer-vocabulary.json names
// beside it, that text removed from that file's lines before the scan; never by loosening the match.
//
// Usage:  node tools/check-vocabulary.mjs [DIR_OR_FILE ...]    (default: src)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** The lists and the allowed texts: { lists: { consumer: [word, ...] }, allowed: [{ text, file, why }] }. */
export function readVocabulary(file = path.join(here, "consumer-vocabulary.json")) {
	const { lists, allowed } = JSON.parse(fs.readFileSync(file, "utf8"));
	return { lists, allowed: allowed ?? [] };
}

/** Splits text into lower-cased words at case changes, underscores, hyphens, letters against digits, and every other non-word character. */
export function splitWords(text) {
	const words = [];
	for (const run of text.match(/[A-Za-z0-9_-]+/g) ?? []) {
		for (const piece of run.split(/[_-]+/)) {
			if (!piece) continue;
			// a lower-case letter or digit then a capital; a capital then a capital and a lower-case letter; a letter against a digit
			for (const word of piece.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/)) if (word) words.push(word.toLowerCase());
		}
	}
	return words;
}

/** Every candidate word of a text: each run whole, each run without its underscores and hyphens, and each split word. */
export function candidateWords(text) {
	const out = [];
	for (const run of text.match(/[A-Za-z0-9_-]+/g) ?? []) {
		const whole = run.toLowerCase();
		out.push(...new Set([whole, whole.replace(/[_-]+/g, ""), ...splitWords(run)]));
	}
	return out;
}

/** The listed word a candidate matches -- equal, or equal once a trailing "s" or "es" is removed -- or undefined. */
function matching(candidate, owner) {
	if (owner.has(candidate)) return candidate;
	if (candidate.endsWith("s") && owner.has(candidate.slice(0, -1))) return candidate.slice(0, -1);
	if (candidate.endsWith("es") && owner.has(candidate.slice(0, -2))) return candidate.slice(0, -2);
	return undefined;
}

/**
 * Every listed word a file's text holds once the texts allowed in that file are removed: [{ line, word, listed,
 * consumer }], in order. `file` is the file's path from the repository's root.
 */
export function findVocabulary(text, { lists, allowed }, file = "") {
	const owner = new Map();
	for (const [consumer, words] of Object.entries(lists)) for (const w of words) owner.set(w.toLowerCase(), consumer);
	const exact = allowed.filter((a) => a.file === file).map((a) => a.text);
	const found = [];
	text.split("\n").forEach((line, i) => {
		let kept = line;
		for (const t of exact) kept = kept.split(t).join(" ");
		for (const word of candidateWords(kept)) {
			const listed = matching(word, owner);
			if (listed !== undefined) found.push({ line: i + 1, word, listed, consumer: owner.get(listed) });
		}
	});
	return found;
}

function filesUnder(target) {
	const stat = fs.statSync(target);
	if (stat.isFile()) return [target];
	return fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => filesUnder(path.join(target, e.name)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const targets = process.argv.slice(2);
	const vocabulary = readVocabulary();
	const files = (targets.length ? targets : [path.join(root, "src")]).flatMap((t) => filesUnder(path.resolve(t)));
	if (files.length === 0) {
		console.log("check-vocabulary: FAIL -- no files found, so nothing was checked");
		process.exit(1);
	}
	let findings = 0;
	for (const file of files) {
		for (const f of findVocabulary(fs.readFileSync(file, "utf8"), vocabulary, path.relative(root, file))) {
			console.log(`  ${path.relative(process.cwd(), file)}:${f.line}  "${f.word}" (${f.consumer}: ${f.listed})`);
			findings++;
		}
	}
	if (findings) {
		console.log(`check-vocabulary: FAIL -- ${findings} word(s) of a consumer's vocabulary in ${files.length} file(s)`);
		process.exit(1);
	}
	console.log(`check-vocabulary: PASS -- ${files.length} file(s), no word of ${Object.keys(vocabulary.lists).join(" or ")}'s vocabulary but the ${vocabulary.allowed.length} text(s) allowed by name`);
}
