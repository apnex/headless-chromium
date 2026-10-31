// trusted-input - HC3 (CONTRACT.md): the traps of trusted input, held once.
//
// The held button: a table of every `buttons` value against the button a move must name, and, in Chrome, a pointer the
// page has taken kept across moves made as mouseEventParams makes them and lost at once by a move naming none -- the
// control that shows the trap is Chrome's, not the test's. Focus loss: a page brought to the front loses the window's
// focus to a second tab, sees one blur, and holds the focus again once the tab is closed.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { BUTTON_BITS, BUTTON_NAMES, connectToPage, findChrome, heldButtonName, launchChrome, loseFocus, mouseEventParams, serveStatic } from "@apnex/headless-chromium";

const TEST = { timeout: 30000 };
const NO_CHROME = findChrome() === null && "no Chrome on PATH and no CHROME set";
const PAGE = `<!doctype html><title>input</title><body style="margin:0"><div id="pad" style="width:400px;height:300px"></div><script>
window.seen = [];
addEventListener("blur", () => seen.push("blur"));
addEventListener("focus", () => seen.push("focus"));
const pad = document.getElementById("pad");
pad.addEventListener("pointerdown", (e) => { pad.setPointerCapture(e.pointerId); seen.push("down"); });
pad.addEventListener("lostpointercapture", () => seen.push("lost"));
pad.addEventListener("pointermove", (e) => seen.push("move " + e.buttons + " " + pad.hasPointerCapture(e.pointerId)));
// the back and forward buttons' release navigates the page unless its default is prevented
addEventListener("mouseup", (e) => e.preventDefault());
</script>`;
let server = null;
let chrome = null;
let page = null;

before(async () => {
	if (NO_CHROME) return;
	server = await serveStatic({ pages: { "/": PAGE } });
	chrome = await launchChrome();
	page = await connectToPage(chrome.port);
	await page.send("Page.navigate", { url: `${server.origin}/` });
	// loaded once the page's own script has run: a load event may still be about:blank's
	for (let i = 0; i < 200 && (await page.evaluate("document.readyState === 'complete' && typeof seen")) !== "object"; i++) await new Promise((resolve) => setTimeout(resolve, 25));
});
after(async () => {
	page?.close();
	await chrome?.close();
	await server?.close();
});
const seen = async () => JSON.parse(await page.evaluate("JSON.stringify(seen.splice(0))"));

test("HC3: the button names and bits are the protocol's and a pointer event's, by button number, frozen", () => {
	assert.deepEqual(BUTTON_NAMES, ["left", "middle", "right", "back", "forward"]);
	assert.deepEqual(BUTTON_BITS, [1, 4, 2, 8, 16]);
	assert.ok(Object.isFrozen(BUTTON_NAMES) && Object.isFrozen(BUTTON_BITS));
});

test("HC3: heldButtonName names the lowest-numbered button a buttons value holds, or none", () => {
	const table = { 0: "none", 1: "left", 2: "right", 3: "left", 4: "middle", 5: "left", 6: "middle", 7: "left", 8: "back", 10: "right", 12: "middle", 16: "forward", 18: "right", 20: "middle", 24: "back", 30: "middle", 31: "left" };
	for (const [buttons, name] of Object.entries(table)) assert.equal(heldButtonName(Number(buttons)), name, `buttons ${buttons}`);
	for (let buttons = 0; buttons < 32; buttons++) {
		const name = heldButtonName(buttons);
		const index = BUTTON_NAMES.indexOf(name);
		assert.ok(name === "none" ? buttons === 0 : (buttons & BUTTON_BITS[index]) !== 0, `buttons ${buttons} holds ${name}`);
		for (let lower = 0; lower < index; lower++) assert.equal(buttons & BUTTON_BITS[lower], 0, `buttons ${buttons}: no lower-numbered button than ${name} is held`);
	}
	for (const wrong of [-1, 32, 1.5, Number.NaN, "1", null]) assert.throws(() => heldButtonName(wrong), { name: "TypeError", message: /^heldButtonName: buttons must be an integer from 0 to 31, not / });
});

test("HC3: mouseEventParams makes a move name its held button, a press or a release click once, and keeps what it is told", () => {
	assert.deepEqual(mouseEventParams("mouseMoved", { x: 1, y: 2 }), { type: "mouseMoved", x: 1, y: 2, button: "none", buttons: 0, clickCount: 0, modifiers: 0, pointerType: "mouse" });
	assert.deepEqual(mouseEventParams("mouseMoved", { x: 1, y: 2 }, { buttons: 6 }), { type: "mouseMoved", x: 1, y: 2, button: "middle", buttons: 6, clickCount: 0, modifiers: 0, pointerType: "mouse" });
	assert.deepEqual(mouseEventParams("mousePressed", { x: 3.5, y: -4 }, { button: "right", buttons: 2, modifiers: 8 }), { type: "mousePressed", x: 3.5, y: -4, button: "right", buttons: 2, clickCount: 1, modifiers: 8, pointerType: "mouse" });
	assert.deepEqual(mouseEventParams("mouseReleased", { x: 0, y: 0 }, { button: "left" }), { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1, modifiers: 0, pointerType: "mouse" });
	assert.equal(mouseEventParams("mouseMoved", { x: 0, y: 0 }, { buttons: 1, button: "none" }).button, "none", "a button named is kept, even one that drops a taken pointer");
	assert.equal(mouseEventParams("mousePressed", { x: 0, y: 0 }, { button: "left", clickCount: 2, pointerType: "pen" }).clickCount, 2);
	const made = mouseEventParams("mouseMoved", { x: 0, y: 0 });
	assert.ok(Object.isFrozen(made));
	assert.deepEqual(Object.keys(made), ["type", "x", "y", "button", "buttons", "clickCount", "modifiers", "pointerType"]);
});

test("HC3: in Chrome, a taken pointer is kept across moves naming their held button, and lost at once by a move naming none", { ...TEST, skip: NO_CHROME }, async () => {
	const send = (type, point, options) => page.send("Input.dispatchMouseEvent", mouseEventParams(type, point, options));
	for (const [index, name] of BUTTON_NAMES.entries()) {
		const bit = BUTTON_BITS[index];
		await send("mouseMoved", { x: 50, y: 50 });
		await seen();
		await send("mousePressed", { x: 50, y: 50 }, { button: name, buttons: bit });
		for (let step = 1; step <= 3; step++) await send("mouseMoved", { x: 50 + step * 20, y: 50 }, { buttons: bit });
		assert.deepEqual(await seen(), ["down", `move ${bit} true`, `move ${bit} true`, `move ${bit} true`], `${name}: the pointer stays taken across moves naming ${name}`);
		await send("mouseMoved", { x: 130, y: 50 }, { buttons: bit, button: "none" });
		assert.deepEqual((await seen()).slice(0, 1), ["lost"], `${name}: control -- a move naming none, its bit held, loses the pointer`);
		await send("mouseReleased", { x: 130, y: 50 }, { button: name, buttons: 0 });
		await seen();
	}
});

test("HC3: loseFocus takes the window's focus with a second tab -- one blur -- and gives it back once the tab is closed", { ...TEST, skip: NO_CHROME }, async () => {
	await loseFocus(page);
	await seen();
	const answer = await loseFocus(page, async ({ targetId }) => {
		assert.equal(await page.evaluate("document.hasFocus()"), false, "the page has lost the focus while `during` runs");
		const { sessionId } = await page.send("Target.attachToTarget", { targetId, flatten: true });
		const there = await page.send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, sessionId);
		return [targetId, there.result.value, await seen()];
	});
	const [targetId, href, during] = answer;
	assert.equal(href, "about:blank", "`during` may act in the second tab");
	assert.deepEqual(during, ["blur"], "one blur, and nothing else, while the focus is lost");
	assert.equal(await page.evaluate("document.hasFocus()"), true, "the page holds the focus again");
	assert.deepEqual(await seen(), ["focus"]);
	const { targetInfos } = await page.send("Target.getTargets");
	assert.ok(!targetInfos.some((t) => t.targetId === targetId), "the second tab is gone");
	const listed = await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json();
	assert.ok(!listed.some((t) => t.id === targetId), "from the HTTP list connectToPage reads too");
	assert.equal(await loseFocus(page), undefined, "with no `during`, it answers undefined");
	await seen();
});

test("HC3: when `during` throws, loseFocus still closes the second tab and gives the focus back, then throws what it threw", { ...TEST, skip: NO_CHROME }, async () => {
	let second = null;
	await assert.rejects(
		loseFocus(page, ({ targetId }) => {
			second = targetId;
			throw new RangeError("during failed");
		}),
		{ name: "RangeError", message: "during failed" },
	);
	assert.equal(await page.evaluate("document.hasFocus()"), true);
	const { targetInfos } = await page.send("Target.getTargets");
	assert.ok(second && !targetInfos.some((t) => t.targetId === second));
	await seen();
});

test("HC3: loseFocus names the step at which the focus did not move as it must", TEST, async () => {
	const stuck = { send: async (method) => (method === "Target.createTarget" ? { targetId: "T" } : method === "Target.getTargets" ? { targetInfos: [] } : {}), evaluate: async () => true };
	await assert.rejects(loseFocus(stuck, undefined, { timeoutMs: 100 }), { name: "Error", message: "loseFocus: within 100 ms, the second tab did not take the window's focus from the page" });
	const unfocused = { send: async () => ({}), evaluate: async () => false };
	await assert.rejects(loseFocus(unfocused, undefined, { timeoutMs: 100 }), { name: "Error", message: "loseFocus: within 100 ms, the page did not hold the window's focus when brought to the front" });
	let focus = true;
	const lingering = { send: async (method) => { if (method === "Target.createTarget") focus = false; return method === "Target.createTarget" ? { targetId: "T" } : method === "Target.getTargets" ? { targetInfos: [{ targetId: "T" }] } : {}; }, evaluate: async () => focus };
	await assert.rejects(loseFocus(lingering, undefined, { timeoutMs: 100 }), { name: "Error", message: "loseFocus: within 100 ms, the second tab did not leave Chrome's targets once closed" });
});
