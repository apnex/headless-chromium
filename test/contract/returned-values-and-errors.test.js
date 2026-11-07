// returned-values-and-errors - CONTRACT.md's Errors and What is returned (I8): every function reads and judges its
// arguments before it does anything, and refuses a malformed one with a TypeError whose message begins with its own
// name and a colon; a refusal starts no process and makes no folder.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { test } from "node:test";

import { scratchFolder } from "@apnex/clean-runner";

import * as headless from "@apnex/headless-chromium";

const { connectToPage, dumpDom, findChrome, heldButtonName, isLockFolderName, launchChrome, lockSocketWarning, loseFocus, mouseEventParams, serveStatic } = headless;

/** Each refusal: a label, the call, and the function name its message begins with. */
const SYNC = [
	["lockSocketWarning, a relative folder", () => lockSocketWarning("tmp"), "lockSocketWarning"],
	["lockSocketWarning, a folder that is no string", () => lockSocketWarning(5), "lockSocketWarning"],
	["isLockFolderName, a name that is no string", () => isLockFolderName(null), "isLockFolderName"],
	["findChrome, env null", () => findChrome(null), "findChrome"],
	["heldButtonName, 32", () => heldButtonName(32), "heldButtonName"],
	["mouseEventParams, an unknown type", () => mouseEventParams("click", { x: 0, y: 0 }), "mouseEventParams"],
	["mouseEventParams, no point", () => mouseEventParams("mouseMoved", null), "mouseEventParams"],
	["mouseEventParams, a coordinate not finite", () => mouseEventParams("mouseMoved", { x: Number.NaN, y: 0 }), "mouseEventParams"],
	["mouseEventParams, options null", () => mouseEventParams("mouseMoved", { x: 0, y: 0 }, null), "mouseEventParams"],
	["mouseEventParams, buttons 32", () => mouseEventParams("mouseMoved", { x: 0, y: 0 }, { buttons: 32 }), "mouseEventParams"],
	["mouseEventParams, an unknown button", () => mouseEventParams("mousePressed", { x: 0, y: 0 }, { button: "top" }), "mouseEventParams"],
	["mouseEventParams, clickCount 4", () => mouseEventParams("mousePressed", { x: 0, y: 0 }, { clickCount: 4 }), "mouseEventParams"],
	["mouseEventParams, modifiers 16", () => mouseEventParams("mousePressed", { x: 0, y: 0 }, { modifiers: 16 }), "mouseEventParams"],
	["mouseEventParams, an unknown pointerType", () => mouseEventParams("mousePressed", { x: 0, y: 0 }, { pointerType: "touch" }), "mouseEventParams"],
];

const ASYNC = [
	["launchChrome, options null", () => launchChrome(null), "launchChrome"],
	["launchChrome, args no array", () => launchChrome({ args: "--x" }), "launchChrome"],
	["launchChrome, an empty chrome", () => launchChrome({ chrome: "" }), "launchChrome"],
	["launchChrome, a url that is no string", () => launchChrome({ chrome: "x", url: 1 }), "launchChrome"],
	["launchChrome, an empty profile", () => launchChrome({ chrome: "x", profile: "" }), "launchChrome"],
	["launchChrome, a start timeout of 0", () => launchChrome({ chrome: "x", startTimeoutMs: 0 }), "launchChrome"],
	["dumpDom, an empty url", () => dumpDom(""), "dumpDom"],
	["dumpDom, options null", () => dumpDom("about:blank", null), "dumpDom"],
	["dumpDom, a negative timeout", () => dumpDom("about:blank", { chrome: "x", timeoutMs: -1 }), "dumpDom"],
	["dumpDom, a budget that is no number", () => dumpDom("about:blank", { chrome: "x", virtualTimeBudgetMs: "10" }), "dumpDom"],
	["connectToPage, port 0", () => connectToPage(0), "connectToPage"],
	["connectToPage, port 70000", () => connectToPage(70000), "connectToPage"],
	["connectToPage, a port that is a string", () => connectToPage("9222"), "connectToPage"],
	["connectToPage, options null", () => connectToPage(9222, null), "connectToPage"],
	["connectToPage, a timeout of 0", () => connectToPage(9222, { timeoutMs: 0 }), "connectToPage"],
	["connectToPage, a negative command timeout", () => connectToPage(9222, { commandTimeoutMs: -1 }), "connectToPage"],
	["loseFocus, no page", () => loseFocus(null), "loseFocus"],
	["loseFocus, a page with no send", () => loseFocus({ evaluate() {} }), "loseFocus"],
	["loseFocus, during no function", () => loseFocus({ send() {}, evaluate() {} }, 1), "loseFocus"],
	["loseFocus, options null", () => loseFocus({ send() {}, evaluate() {} }, undefined, null), "loseFocus"],
	["loseFocus, a timeout of 0", () => loseFocus({ send() {}, evaluate() {} }, undefined, { timeoutMs: 0 }), "loseFocus"],
	["serveStatic, options null", () => serveStatic(null), "serveStatic"],
	["serveStatic, folders a string", () => serveStatic({ folders: "/" }), "serveStatic"],
	["serveStatic, a prefix with no leading slash", () => serveStatic({ folders: { "app/": "/tmp" } }), "serveStatic"],
	["serveStatic, a prefix with no trailing slash", () => serveStatic({ folders: { "/app": "/tmp" } }), "serveStatic"],
	["serveStatic, an empty folder", () => serveStatic({ folders: { "/": "" } }), "serveStatic"],
	["serveStatic, a page path with no leading slash", () => serveStatic({ pages: { "index.html": "x" } }), "serveStatic"],
	["serveStatic, a page that is a number", () => serveStatic({ pages: { "/": 1 } }), "serveStatic"],
	["serveStatic, a page with no type", () => serveStatic({ pages: { "/": { body: "x" } } }), "serveStatic"],
	["serveStatic, headers no function", () => serveStatic({ headers: {} }), "serveStatic"],
	["serveStatic, contentTypes a string", () => serveStatic({ contentTypes: "text/html" }), "serveStatic"],
	["serveStatic, an index holding a slash", () => serveStatic({ index: "a/index.html" }), "serveStatic"],
	["serveStatic, an empty index", () => serveStatic({ index: "" }), "serveStatic"],
];

test("I8: each function refuses a malformed argument with a TypeError beginning with its name, before it starts or makes anything", async () => {
	// a temporary folder of this test's own, so what other test files make meanwhile is not counted
	const own = scratchFolder("rv-");
	const saved = process.env.TMPDIR;
	process.env.TMPDIR = own;
	try {
		assert.equal(os.tmpdir(), own, "control: the refusals run with a temporary folder of their own");
		for (const [index, [label, call, name]] of SYNC.entries()) {
			assert.throws(call, (error) => error instanceof TypeError && error.message.startsWith(`${name}: `), `${index}: ${label}`);
		}
		for (const [index, [label, call, name]] of ASYNC.entries()) {
			await assert.rejects(call, (error) => error instanceof TypeError && error.message.startsWith(`${name}: `), `${index}: ${label}`);
		}
	} finally {
		process.env.TMPDIR = saved;
	}
	assert.deepEqual(fs.readdirSync(own), [], "no refusal made a folder");
});

test("I8: an async function refuses by rejecting, never by throwing as it is called", () => {
	for (const [index, [label, call]] of ASYNC.entries()) {
		let answered;
		assert.doesNotThrow(() => (answered = call()), `${index}: ${label}`);
		assert.ok(answered instanceof Promise, `${index}: ${label}`);
		answered.catch(() => {});
	}
});

test("I8: a failure of the world, not of an argument, is an Error beginning with the function's name", async () => {
	await assert.rejects(launchChrome({ chrome: "/no/such/chrome", startTimeoutMs: 5000 }), (error) => error.constructor === Error && error.message.startsWith("launchChrome: Chrome exited before it wrote its debugging port, ") && error.message.includes(" ms into the start bound of 5000 ms: exit code 127 ("));
	await assert.rejects(dumpDom("about:blank", { chrome: "/no/such/chrome" }), (error) => error.constructor === Error && error.message === "dumpDom: Chrome exited with exit code 127 (about:blank)");
	await assert.rejects(connectToPage(9, { timeoutMs: 200 }), (error) => error.constructor === Error && error.message.startsWith("connectToPage: no page target on port 9 in time ("));
});
