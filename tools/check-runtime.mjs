#!/usr/bin/env node
// check-runtime - the runtime check (the components' check, adapted to a component whose platform is its runtime;
// CONTRACT.md HC5 and I6): fails when a built file imports anything but a relative file, one of the runtime's
// built-in modules or a runtime dependency by its bare name, holds a dynamic `import(`, names `require`, `window`, `document`, `self`, `global` or
// `globalThis`, or names `eval` or `Function`, or calls or constructs through a property named `constructor`
// (`f.constructor("return this")`), each of which reaches the global object from a string of code.
//
// The runtime's built-in modules are this component's platform -- it reads files, opens sockets and listens -- so its
// check allows them, where the four components' allows none. They are allowed under either
// spelling, `node:fs` or `fs`: the source imports them by their bare names, since `node` is a word of draw's
// vocabulary its source must not hold (docs/DECISIONS.md D2). A package fails unless package.json names it as a
// runtime dependency, and then only by its bare name: `@apnex/clean-runner` is allowed, and a path into it --
// `@apnex/clean-runner/dist/...` -- fails, so the component reaches clean-runner through its public exports alone.
//
// And it allows exactly the globals the build uses, and nothing more: every identifier that refers to a name the
// file does not declare -- resolved by TypeScript's own checker over the file alone, with no library, so a name the
// file declares in any scope is the file's own -- must be one of ALLOWED_GLOBALS, so a global the build has no use
// for fails however it is reached by name; a test holds the list to exactly the globals the built files name, so a
// global the build stops using leaves the list with it. The four components' platform-member pass is not run: the
// component is handed no platform object whose members could be counted, only the runtime's own modules.
//
// Each file is parsed by TypeScript into a syntax tree (ts.createSourceFile, ScriptKind.JS, as a module), so
// comments, strings, template literals and regular-expression literals are what the language says they are. A file
// TypeScript cannot parse without a diagnostic fails the check rather than being guessed at.
//
// Usage:  node tools/check-runtime.mjs [DIR_OR_FILE ...]    (default: dist, its .js files)
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RUNTIME_NAMES = ["require", "window", "document", "self", "global", "globalThis", "eval", "Function"];

/** The globals the build names: the only names a built file may use without declaring them. */
export const ALLOWED_GLOBALS = Object.freeze(["Array", "Date", "Error", "JSON", "Map", "Math", "Number", "Object", "Promise", "Set", "String", "TypeError", "URL", "Uint8Array", "WebSocket", "clearTimeout", "decodeURIComponent", "fetch", "process", "setTimeout", "undefined"]);

/** True when a module specifier names one of the runtime's built-in modules, under either spelling. */
/** The runtime dependencies package.json names, each allowed by its bare name alone. */
export const RUNTIME_DEPENDENCIES = Object.freeze(Object.keys(JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).dependencies ?? {}));

export const isBuiltinModule = (specifier) => builtinModules.includes(specifier.startsWith("node:") ? specifier.slice(5) : specifier);

/** True when a callee is a property named `constructor`, reached by dot or by brackets with a string literal. */
const isConstructorProperty = (callee) =>
	(ts.isPropertyAccessExpression(callee) && callee.name.text === "constructor") ||
	(ts.isElementAccessExpression(callee) && (ts.isStringLiteral(callee.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(callee.argumentExpression)) && callee.argumentExpression.text === "constructor");

/** A built file's syntax tree, parsed as an ES module; throws when TypeScript reports a parse diagnostic. */
export function parseModule(source, fileName = "built.js") {
	const file = ts.createSourceFile(fileName, source, { languageVersion: ts.ScriptTarget.Latest, impliedNodeFormat: ts.ModuleKind.ESNext }, true, ts.ScriptKind.JS);
	const diagnostics = file.parseDiagnostics ?? [];
	if (diagnostics.length) {
		const first = diagnostics[0];
		const line = file.getLineAndCharacterOfPosition(first.start ?? 0).line + 1;
		throw new Error(`check-runtime: TypeScript could not parse the file: line ${line}: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`);
	}
	return file;
}

/** True when an identifier stands for a value it names, rather than for a member's, a key's, a label's or an import's or export's name. */
function isReference(node) {
	const parent = node.parent;
	if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && parent.name === node) return false;
	if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent)) && parent.name === node) return false;
	if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
	if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isNamespaceExport(parent)) return false;
	if (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent) || ts.isMetaProperty(parent)) return false;
	return true;
}

/**
 * Every identifier of a parsed file that refers to no declaration of the file -- a global -- as [{ name, line }], in
 * source order: TypeScript's checker resolves each over the file alone, with no library.
 */
export function freeGlobalReferences(file) {
	const host = {
		getSourceFile: (name) => (name === file.fileName ? file : undefined),
		getDefaultLibFileName: () => "lib.d.ts",
		writeFile() {},
		getCurrentDirectory: () => "/",
		getDirectories: () => [],
		fileExists: (name) => name === file.fileName,
		readFile: (name) => (name === file.fileName ? file.text : undefined),
		getCanonicalFileName: (name) => name,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => "\n",
	};
	const program = ts.createProgram([file.fileName], { allowJs: true, noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }, host);
	const checker = program.getTypeChecker();
	const found = [];
	const visit = (node) => {
		if (ts.isIdentifier(node) && isReference(node)) {
			const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
			if (!(symbol?.declarations ?? []).some((declaration) => declaration.getSourceFile() === file)) found.push({ name: node.text, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/** Every runtime finding in a built file's source: [{ line, finding }], in source order. */
export function findRuntimeUses(source, fileName) {
	const file = parseModule(source, fileName);
	const found = [];
	const lineOf = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
	const visit = (node) => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
			const specifier = node.moduleSpecifier.text;
			if (!specifier.startsWith("./") && !specifier.startsWith("../") && !isBuiltinModule(specifier) && !RUNTIME_DEPENDENCIES.includes(specifier)) found.push({ line: lineOf(node), finding: `imports "${specifier}", which is neither a relative file, a built-in module nor a runtime dependency by its bare name` });
		}
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push({ line: lineOf(node), finding: "holds a dynamic import(" });
		if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && isConstructorProperty(node.expression)) found.push({ line: lineOf(node), finding: "calls through a property named constructor, which reaches Function" });
		if (ts.isIdentifier(node) && RUNTIME_NAMES.includes(node.text)) {
			const member = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
			if (!member) found.push({ line: lineOf(node), finding: `names ${node.text}` });
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	for (const { name, line } of freeGlobalReferences(file)) {
		if (ALLOWED_GLOBALS.includes(name) || found.some((f) => f.line === line && f.finding === `names ${name}`)) continue;
		found.push({ line, finding: `names the global ${name}, which is none of the globals the build uses` });
	}
	return found.sort((a, b) => a.line - b.line);
}

function jsFilesUnder(target) {
	const stat = fs.statSync(target);
	if (stat.isFile()) return target.endsWith(".js") ? [target] : [];
	return fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => jsFilesUnder(path.join(target, e.name)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const targets = process.argv.slice(2);
	const files = (targets.length ? targets : [path.join(root, "dist")]).flatMap((t) => jsFilesUnder(path.resolve(t)));
	if (files.length === 0) {
		console.log("check-runtime: FAIL -- no built .js files found; run npm run build first");
		process.exit(1);
	}
	let findings = 0;
	for (const file of files) {
		let uses;
		try {
			uses = findRuntimeUses(fs.readFileSync(file, "utf8"), path.basename(file));
		} catch (e) {
			uses = [{ line: 1, finding: e.message }];
		}
		for (const f of uses) {
			console.log(`  ${path.relative(process.cwd(), file)}:${f.line}  ${f.finding}`);
			findings++;
		}
	}
	if (findings) {
		console.log(`check-runtime: FAIL -- ${findings} runtime use(s) beyond what headless-chromium may use in ${files.length} built file(s)`);
		process.exit(1);
	}
	console.log(`check-runtime: PASS -- ${files.length} built file(s) import only relative files, the runtime's built-in modules and ${RUNTIME_DEPENDENCIES.join(", ")} by its bare name, and name no global but the ${ALLOWED_GLOBALS.length} the build uses`);
}
