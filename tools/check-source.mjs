#!/usr/bin/env node
// check-source - the source check (input-capture's, as vector-scene keeps it, adapted to a component whose platform
// is its runtime; CONTRACT.md HC5 and I6): fails when src/ could declare a global, or compile against a library
// other than the language's and the runtime's own types.
//
// It walks every file under src/ with TypeScript's parser (ts.createSourceFile, ScriptKind.TS) and fails on:
// - a declaration file there -- `.d.ts`, `.d.mts` or `.d.cts`;
// - any declaration carrying `declare` -- `var`, `let`, `const`, `function`, `class`, `enum`, `namespace`,
//   `module`, `global`, `type`, `interface`, or a class field;
// - a triple-slash directive -- a reference to a path, to types or to a lib, `no-default-lib`, or any
//   other comment opening `///` and `<`;
// - a file that is no ES module, since every top-level declaration of a script is a global;
// - a file TypeScript cannot parse without a diagnostic, rather than guessing at it.
// It checks that tsconfig.json's `lib` is `["ES2022"]` and its `types` the runtime's own alone -- the one package of
// types headless-chromium compiles against, its platform being the runtime -- that it extends no other configuration,
// names no `files`, `typeRoots` or `references`, and includes `src` alone; and then makes TypeScript's own program
// from that configuration and fails if any DOM, web worker or script host library is among the files it would
// compile, or any file outside src/, TypeScript's own libraries, the runtime's types with the one package they
// name for their fetch and WebSocket globals, and the declaration files of the runtime dependencies package.json names.
//
// Usage:  node tools/check-source.mjs [ROOT]    (default: this repository)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DECLARATION_FILE = /\.d\.[mc]?ts$/;
const SOURCE_FILE = /\.[mc]?ts$/;
const PLATFORM_LIBRARY = /(^|[\\/])lib\.(dom|webworker|scripthost)[.a-z]*\.d\.ts$/i;
/** The one package of types tsconfig.json names: the runtime's own. */
export const RUNTIME_TYPES = ["node"];
/** The packages whose declaration files the program may compile beside src/ and TypeScript's libraries: the runtime's types, and the package they name for fetch and WebSocket. */
const TYPE_PACKAGES = [`@types/${RUNTIME_TYPES[0]}`, "undici-types"];

/** What a declaration carrying `declare` declares, for a finding. */
function declaredKind(node) {
	if (ts.isVariableStatement(node)) {
		const flags = node.declarationList.flags;
		return flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";
	}
	if (ts.isFunctionDeclaration(node)) return "function";
	if (ts.isClassDeclaration(node)) return "class";
	if (ts.isEnumDeclaration(node)) return "enum";
	if (ts.isModuleDeclaration(node)) return node.flags & ts.NodeFlags.GlobalAugmentation ? "global" : node.flags & ts.NodeFlags.Namespace ? "namespace" : "module";
	if (ts.isTypeAliasDeclaration(node)) return "type";
	if (ts.isInterfaceDeclaration(node)) return "interface";
	if (ts.isPropertyDeclaration(node)) return "class field";
	return ts.SyntaxKind[node.kind];
}

/** Every finding in one source file's text: [{ line, finding }], in source order. */
export function findSourceProblems(source, fileName = "source.ts") {
	const file = ts.createSourceFile(fileName, source, { languageVersion: ts.ScriptTarget.Latest, impliedNodeFormat: ts.ModuleKind.ESNext }, true, ts.ScriptKind.TS);
	const diagnostics = file.parseDiagnostics ?? [];
	if (diagnostics.length) {
		const first = diagnostics[0];
		const line = file.getLineAndCharacterOfPosition(first.start ?? 0).line + 1;
		return [{ line, finding: `TypeScript could not parse the file: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}` }];
	}
	const found = [];
	const lineAt = (position) => file.getLineAndCharacterOfPosition(position).line + 1;
	const visit = (node) => {
		const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
		if (modifiers.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) found.push({ line: lineAt(node.getStart(file)), finding: `declares with \`declare\` (${declaredKind(node)})` });
		ts.forEachChild(node, visit);
	};
	visit(file);
	// triple-slash directives, as TypeScript reads them at the top of a file, and any comment of their form anywhere
	for (const ref of file.referencedFiles) found.push({ line: lineAt(ref.pos), finding: `holds a triple-slash reference to the path "${ref.fileName}"` });
	for (const ref of file.typeReferenceDirectives) found.push({ line: lineAt(ref.pos), finding: `holds a triple-slash reference to the types "${ref.fileName}"` });
	for (const ref of file.libReferenceDirectives) found.push({ line: lineAt(ref.pos), finding: `holds a triple-slash reference to the lib "${ref.fileName}"` });
	if (file.hasNoDefaultLib) found.push({ line: 1, finding: "holds a triple-slash no-default-lib directive" });
	// every comment is found from the parsed tree -- the leading and trailing comment ranges of each token, the
	// end-of-file token's among them -- since a bare scanner reads a template literal's text after its first
	// substitution as code, and would miss a comment anywhere after it
	const comments = new Map();
	const collect = (node) => {
		for (const range of [...(ts.getLeadingCommentRanges(source, node.pos) ?? []), ...(ts.getTrailingCommentRanges(source, node.end) ?? [])]) comments.set(range.pos, range);
		for (const child of node.getChildren(file)) collect(child);
	};
	collect(file);
	for (const range of comments.values()) {
		if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia && /^\/\/\/\s*</.test(source.slice(range.pos, range.end))) {
			const line = lineAt(range.pos);
			if (!found.some((f) => f.line === line && f.finding.startsWith("holds a triple-slash"))) found.push({ line, finding: "holds a comment of a triple-slash directive's form" });
		}
	}
	if (!ts.isExternalModule(file)) found.push({ line: 1, finding: "is no ES module, so its top-level declarations would be globals" });
	return found.sort((a, b) => a.line - b.line);
}

/** Every problem with a tsconfig.json's settings that could bring another library in. */
export function findConfigProblems(config) {
	const problems = [];
	const options = config.compilerOptions ?? {};
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	if (!same(options.lib, ["ES2022"])) problems.push(`compilerOptions.lib is ${JSON.stringify(options.lib)}, not ["ES2022"]`);
	if (!same(options.types, RUNTIME_TYPES)) problems.push(`compilerOptions.types is ${JSON.stringify(options.types)}, not ${JSON.stringify(RUNTIME_TYPES)}`);
	if (options.typeRoots !== undefined) problems.push("compilerOptions.typeRoots is set");
	if (options.noLib !== undefined) problems.push("compilerOptions.noLib is set");
	if (config.extends !== undefined) problems.push(`it extends ${JSON.stringify(config.extends)}`);
	if (config.files !== undefined) problems.push("it names files");
	if (config.references !== undefined) problems.push("it names project references");
	if (!same(config.include, ["src"])) problems.push(`include is ${JSON.stringify(config.include)}, not ["src"]`);
	return problems;
}

function filesUnder(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** Every problem in a repository: its src/ files, its tsconfig.json, and the program TypeScript makes from both. */
export function sourceProblems(root) {
	const problems = [];
	const src = path.join(root, "src");
	const files = filesUnder(src);
	if (files.length === 0) problems.push("src/ holds no file, so nothing was checked");
	for (const file of files) {
		const rel = path.relative(root, file);
		if (DECLARATION_FILE.test(file)) {
			problems.push(`${rel}: is a declaration file`);
			continue;
		}
		if (!SOURCE_FILE.test(file)) continue;
		for (const f of findSourceProblems(fs.readFileSync(file, "utf8"), path.basename(file))) problems.push(`${rel}:${f.line}: ${f.finding}`);
	}
	const configFile = path.join(root, "tsconfig.json");
	const read = ts.readConfigFile(configFile, (p) => fs.readFileSync(p, "utf8"));
	if (read.error) {
		problems.push(`tsconfig.json: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`);
		return problems;
	}
	for (const p of findConfigProblems(read.config)) problems.push(`tsconfig.json: ${p}`);
	const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configFile);
	const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
	const libraries = path.dirname(ts.getDefaultLibFilePath(parsed.options));
	const dependencies = Object.keys(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).dependencies ?? {});
	const packages = [...TYPE_PACKAGES, ...dependencies].map((p) => path.join(root, "node_modules", p) + path.sep);
	for (const sourceFile of program.getSourceFiles()) {
		const name = path.resolve(sourceFile.fileName);
		if (PLATFORM_LIBRARY.test(name)) problems.push(`the program compiles ${path.basename(name)}, a platform library`);
		else if (!name.startsWith(src + path.sep) && !name.startsWith(path.resolve(libraries) + path.sep) && !packages.some((p) => name.startsWith(p))) problems.push(`the program compiles ${path.relative(root, name)}, outside src/, TypeScript's own libraries and the runtime's types`);
	}
	return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = path.resolve(process.argv[2] ?? here);
	const problems = sourceProblems(root);
	for (const p of problems) console.log(`  ${p}`);
	if (problems.length) {
		console.log(`check-source: FAIL -- ${problems.length} problem(s): src/ could declare a global, or compile against a library beyond the language's and the runtime's`);
		process.exit(1);
	}
	const count = filesUnder(path.join(root, "src")).length;
	console.log(`check-source: PASS -- ${count} file(s) in src/ declare nothing ambient and reference no library, and the program compiles ES2022's libraries and the runtime's types, with the runtime dependencies' declarations, alone`);
}
