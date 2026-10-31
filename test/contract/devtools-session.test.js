// devtools-session - HC2 (CONTRACT.md): a DevTools protocol session with a page, over the runtime's global WebSocket.
//
// Against a real Chrome: commands answered and refused, events handed out and stopped, a command sent to an attached
// second tab, and every way a waiting command is let go -- the session closed, Chrome gone, no answer in time -- so a
// test never hangs on a browser that has died. A server answering an empty target list stands in for a Chrome with
// no page.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";

import { connectToPage, findChrome, launchChrome, serveStatic } from "@apnex/headless-chromium";
import { ROOT } from "../support/helpers.js";

const TEST = { timeout: 30000 };
const NO_CHROME = findChrome() === null && "no Chrome on PATH and no CHROME set";
let chrome = null;
let page = null;

before(async () => {
	if (NO_CHROME) return;
	chrome = await launchChrome();
	page = await connectToPage(chrome.port);
});
after(async () => {
	page?.close();
	await chrome?.close();
});

test("HC2: a session answers commands with the protocol's result, and evaluate with the expression's value, awaiting a promise", { ...TEST, skip: NO_CHROME }, async () => {
	assert.deepEqual(Object.keys(page), ["targetId", "port", "send", "on", "evaluate", "close"]);
	assert.ok(Object.isFrozen(page));
	assert.equal(page.port, chrome.port);
	const targets = await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json();
	assert.ok(targets.some((t) => t.type === "page" && t.id === page.targetId), "the session's target is a page of that Chrome");
	assert.deepEqual(await page.send("Runtime.evaluate", { expression: "6 * 7", returnByValue: true }), { result: { type: "number", value: 42, description: "42" } });
	assert.equal(await page.evaluate("1 + 1"), 2);
	assert.deepEqual(await page.evaluate("Promise.resolve({ a: [1, 'b'] })"), { a: [1, "b"] });
	assert.equal(await page.evaluate("undefined"), undefined);
});

test("HC2: a protocol error rejects with the method's name first; a page that throws rejects evaluate with what it threw", { ...TEST, skip: NO_CHROME }, async () => {
	await assert.rejects(page.send("No.suchMethod"), (error) => error instanceof Error && error.message.startsWith("No.suchMethod: ") && /wasn't found/.test(error.message));
	await assert.rejects(page.evaluate("throw new Error('boom')"), (error) => error instanceof Error && error.message.startsWith("evaluate: the page threw: Error: boom"));
	await assert.rejects(page.evaluate("Promise.reject(new RangeError('later'))"), (error) => error.message.startsWith("evaluate: the page threw: RangeError: later"));
	assert.equal(await page.evaluate("'still answering'"), "still answering", "the session goes on");
});

test("HC2: on hands every event of a method to its listener until stopped, with the sessionId of an attached target", { ...TEST, skip: NO_CHROME }, async () => {
	const seen = [];
	const stop = page.on("Runtime.consoleAPICalled", (params, sessionId) => seen.push([params.args[0].value, sessionId]));
	await page.send("Runtime.enable");
	await page.evaluate("console.log('one'), console.log('two')");
	await page.evaluate("new Promise((r) => setTimeout(r, 100))");
	assert.deepEqual(seen, [["one", undefined], ["two", undefined]]);
	stop();
	await page.evaluate("console.log('three')");
	await page.evaluate("new Promise((r) => setTimeout(r, 100))");
	assert.equal(seen.length, 2, "a stopped listener hears nothing more");
	await page.send("Runtime.disable");
});

test("HC2: a command with a sessionId goes to the target a flattened attach named -- a second tab", { ...TEST, skip: NO_CHROME }, async () => {
	await page.send("Page.navigate", { url: "about:blank#first" });
	const { targetId } = await page.send("Target.createTarget", { url: "about:blank#second" });
	try {
		const { sessionId } = await page.send("Target.attachToTarget", { targetId, flatten: true });
		const there = await page.send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, sessionId);
		assert.equal(there.result.value, "about:blank#second");
		assert.equal(await page.evaluate("location.href"), "about:blank#first", "control: without it, the page");
	} finally {
		await page.send("Target.closeTarget", { targetId });
		// connectToPage reads Chrome's HTTP list, which can still hold a closed tab for a moment: a later test must not attach to it
		const listed = async () => (await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json()).some((t) => t.id === targetId);
		for (const until = Date.now() + 5000; (await listed()) && Date.now() < until; ) await new Promise((resolve) => setTimeout(resolve, 25));
		assert.equal(await listed(), false, "the closed tab has left the list");
	}
});

test("HC2: send, on and evaluate refuse a malformed argument with a TypeError beginning with their name", { ...TEST, skip: NO_CHROME }, async () => {
	await assert.rejects(page.send(""), { name: "TypeError", message: "send: the method must be a non-empty string" });
	await assert.rejects(page.send("Runtime.evaluate", []), { name: "TypeError", message: "send: the params of Runtime.evaluate must be an object" });
	await assert.rejects(page.send("Runtime.evaluate", {}, 7), { name: "TypeError", message: "send: the sessionId of Runtime.evaluate must be a string" });
	assert.throws(() => page.on("", () => {}), { name: "TypeError", message: "on: the method must be a non-empty string" });
	assert.throws(() => page.on("Page.loadEventFired", null), { name: "TypeError", message: "on: the listener for Page.loadEventFired must be a function" });
	await assert.rejects(page.evaluate(42), { name: "TypeError", message: "evaluate: the expression must be a string" });
});

test("HC2: closing a session rejects every waiting command and every later one, and closing again does nothing", { ...TEST, skip: NO_CHROME }, async () => {
	const second = await connectToPage(chrome.port);
	const waiting = second.send("Runtime.evaluate", { expression: "new Promise(() => {})", awaitPromise: true });
	second.close();
	const first = await Promise.race([waiting.then(() => "answered", (error) => error.message), Promise.resolve().then(() => "still waiting")]);
	assert.equal(first, "Runtime.evaluate: the session closed", "rejected at once, not once the socket's close is seen");
	await assert.rejects(waiting, { message: "Runtime.evaluate: the session closed" });
	await assert.rejects(second.send("Runtime.evaluate", { expression: "1" }), { message: "Runtime.evaluate: the session is closed" });
	assert.equal(second.close(), undefined);
});

test("HC2: a command unanswered within its bound rejects; a Chrome that dies under a session rejects what waits", { ...TEST, skip: NO_CHROME }, async () => {
	const impatient = await connectToPage(chrome.port, { commandTimeoutMs: 300 });
	try {
		await assert.rejects(impatient.evaluate("new Promise(() => {})"), { message: "Runtime.evaluate: no answer within 300 ms" });
	} finally {
		impatient.close();
	}
	const doomed = await launchChrome();
	const session = await connectToPage(doomed.port);
	const rejected = assert.rejects(session.evaluate("new Promise(() => {})"), { message: "Runtime.evaluate: the session closed" });
	await doomed.close();
	await rejected;
});

test("HC2: a Chrome with no page target is refused once the bound passes, naming what it listed", TEST, async () => {
	const server = await serveStatic({ pages: { "/json/list": { body: "[]", type: "application/json" } } });
	try {
		const port = Number(new URL(server.origin).port);
		await assert.rejects(connectToPage(port, { timeoutMs: 300 }), { name: "Error", message: `connectToPage: no page target on port ${port} in time (0 target(s), none a page)` });
		assert.ok(server.requests.length >= 2, "the list was asked for again while the bound ran");
	} finally {
		await server.close();
	}
});

test("HC2: a runtime with no global WebSocket is refused naming the version that holds one", TEST, () => {
	const body = `import { connectToPage } from "@apnex/headless-chromium"; delete globalThis.WebSocket; connectToPage(9).then(() => console.log("connected"), (e) => console.log(e.constructor.name + ": " + e.message));`;
	const out = spawnSync(process.execPath, ["--input-type=module", "-e", body], { cwd: ROOT, encoding: "utf8" });
	assert.equal(out.stdout, "Error: connectToPage: this runtime has no global WebSocket; version 22.4 and later hold one\n", out.stderr);
});
