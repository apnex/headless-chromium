#!/usr/bin/env node
// measure-size - the built size (recorded in docs/DECISIONS.md at build, as the four components record theirs): every
// built module, as shipped, comments included, and again with its comments removed (TypeScript's transpiler,
// removeComments), each gzipped at level 9 too.
//
// Usage:  node tools/measure-size.mjs    (after npm run build)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

const stripped = (source) => ts.transpileModule(source, { compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/\n\/\/# sourceMappingURL=.*$/m, "");

/** Bytes of one built file: as shipped and without comments, each raw and gzipped. */
export function measure(file) {
	const source = fs.readFileSync(path.join(dist, file), "utf8");
	const bare = stripped(source);
	return { file, bytes: Buffer.byteLength(source), gzip: gzipSync(source, { level: 9 }).length, bare: Buffer.byteLength(bare), bareGzip: gzipSync(bare, { level: 9 }).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const rows = fs.readdirSync(dist).filter((f) => f.endsWith(".js")).sort().map(measure);
	if (rows.length === 0) {
		console.log("measure-size: FAIL -- no built .js files; run npm run build first");
		process.exit(1);
	}
	console.log("file                      bytes   gzip   no comments   gzip");
	for (const r of rows) console.log(`${r.file.padEnd(24)} ${String(r.bytes).padStart(6)} ${String(r.gzip).padStart(6)} ${String(r.bare).padStart(13)} ${String(r.bareGzip).padStart(6)}`);
	const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
	console.log(`${"(total)".padEnd(24)} ${String(sum("bytes")).padStart(6)} ${String(sum("gzip")).padStart(6)} ${String(sum("bare")).padStart(13)} ${String(sum("bareGzip")).padStart(6)}`);
}
