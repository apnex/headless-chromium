// trusted-input - the traps of trusted input over the DevTools protocol, held once (CONTRACT.md HC3).
//
// A mouse move dispatched by Input.dispatchMouseEvent must name a held button in `button` as well as in `buttons`:
// Chrome drops a pointer the page has taken -- its capture lost at once -- on a move whose `button` is "none" while
// `buttons` holds a bit. So a move names, by default, the lowest-numbered button its `buttons` holds.
//
// A page focused by input alone keeps document.hasFocus() through a second tab opened over it, with no blur; brought
// to the front first, it holds the window's focus, and a second tab then takes it. So focus is lost by bringing the
// page to the front, waiting until it holds the focus, opening a second tab, and waiting until the page has lost it;
// and given back by closing that tab, waiting until Chrome no longer lists it, and bringing the page to the front.
import type { PageSession } from "./devtools-session.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The protocol's names for the five mouse buttons, by button number: 0 the main button, 1 the middle, 2 the secondary. */
export const BUTTON_NAMES = Object.freeze(["left", "middle", "right", "back", "forward"] as const);

/** Each button's bit in `buttons`, by button number, as a pointer event's `buttons` holds them: the middle button's is 4 and the secondary's 2. */
export const BUTTON_BITS = Object.freeze([1, 4, 2, 8, 16] as const);

export type ButtonName = (typeof BUTTON_NAMES)[number];
export type MouseEventType = "mousePressed" | "mouseReleased" | "mouseMoved";

export interface MouseOptions {
	/** The button the event names; for a move, the lowest-numbered button `buttons` holds by default, else "none". */
	readonly button?: ButtonName | "none";
	/** The buttons held, as BUTTON_BITS; 0 by default. */
	readonly buttons?: number;
	/** 1 by default for a press or a release, 0 for a move. */
	readonly clickCount?: number;
	/** The protocol's modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8; 0 by default. */
	readonly modifiers?: number;
	/** "mouse" by default. */
	readonly pointerType?: "mouse" | "pen";
}

/** The params of one Input.dispatchMouseEvent command. */
export interface MouseEventParams {
	readonly type: MouseEventType;
	readonly x: number;
	readonly y: number;
	readonly button: ButtonName | "none";
	readonly buttons: number;
	readonly clickCount: number;
	readonly modifiers: number;
	readonly pointerType: "mouse" | "pen";
}

/** The protocol's name for the lowest-numbered button `buttons` holds, or "none" when it holds none. */
export function heldButtonName(buttons: number): ButtonName | "none" {
	if (!Number.isSafeInteger(buttons) || buttons < 0 || buttons > 31) throw new TypeError(`heldButtonName: buttons must be an integer from 0 to 31, not ${String(buttons)}`);
	const i = BUTTON_BITS.findIndex((bit) => (buttons & bit) !== 0);
	return i === -1 ? "none" : (BUTTON_NAMES[i] as ButtonName);
}

const integerIn = (name: string, key: string, value: unknown, low: number, high: number): number => {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < low || value > high) throw new TypeError(`${name}: ${key} must be an integer from ${low} to ${high}, not ${String(value)}`);
	return value;
};

/** The params of an Input.dispatchMouseEvent command, a move naming its held button unless told otherwise. */
export function mouseEventParams(type: MouseEventType, point: { readonly x: number; readonly y: number }, options: MouseOptions = {}): MouseEventParams {
	const name = "mouseEventParams";
	if (type !== "mousePressed" && type !== "mouseReleased" && type !== "mouseMoved") throw new TypeError(`${name}: the type must be mousePressed, mouseReleased or mouseMoved, not ${String(type)}`);
	if (point === null || typeof point !== "object" || typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${name}: the point must hold finite numbers x and y`);
	if (options === null || typeof options !== "object") throw new TypeError(`${name}: options must be an object`);
	const buttons = options.buttons === undefined ? 0 : integerIn(name, "buttons", options.buttons, 0, 31);
	const button = options.button ?? (type === "mouseMoved" ? heldButtonName(buttons) : "none");
	if (button !== "none" && !BUTTON_NAMES.includes(button)) throw new TypeError(`${name}: button must be one of ${BUTTON_NAMES.join(", ")} or none, not ${String(button)}`);
	const clickCount = options.clickCount === undefined ? (type === "mouseMoved" ? 0 : 1) : integerIn(name, "clickCount", options.clickCount, 0, 3);
	const modifiers = options.modifiers === undefined ? 0 : integerIn(name, "modifiers", options.modifiers, 0, 15);
	const pointerType = options.pointerType ?? "mouse";
	if (pointerType !== "mouse" && pointerType !== "pen") throw new TypeError(`${name}: pointerType must be mouse or pen, not ${String(pointerType)}`);
	return Object.freeze({ type, x: point.x, y: point.y, button, buttons, clickCount, modifiers, pointerType });
}

export interface LoseFocusOptions {
	/** How long each wait -- for the focus held, lost, and held again, and for the second tab to go -- may take, in milliseconds; 5000 by default. */
	readonly timeoutMs?: number;
}

/**
 * Takes the window's focus from the page with a second tab, runs `during` while the page has lost it -- handed the
 * second tab's target id, so it may attach to it and act there -- then closes the tab and gives the focus back.
 * Answers what `during` answered. Throws, naming the step, when the focus does not move as it must.
 */
export async function loseFocus<T>(page: PageSession, during?: (second: { readonly targetId: string }) => T | Promise<T>, options: LoseFocusOptions = {}): Promise<T | undefined> {
	if (page === null || typeof page !== "object" || typeof page.send !== "function" || typeof page.evaluate !== "function") throw new TypeError("loseFocus: the page must be a session connectToPage answered");
	if (during !== undefined && typeof during !== "function") throw new TypeError("loseFocus: during must be a function");
	if (options === null || typeof options !== "object") throw new TypeError("loseFocus: options must be an object");
	const timeoutMs = options.timeoutMs ?? 5000;
	if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("loseFocus: timeoutMs must be a positive number of milliseconds");
	const waitUntil = async (holds: () => Promise<boolean>, why: string): Promise<void> => {
		for (const until = Date.now() + timeoutMs; !(await holds()); ) {
			if (Date.now() >= until) throw new Error(`loseFocus: within ${timeoutMs} ms, ${why}`);
			await sleep(25);
		}
	};
	const focused = async (): Promise<boolean> => (await page.evaluate("document.hasFocus()")) === true;
	await page.send("Page.bringToFront");
	await waitUntil(focused, "the page did not hold the window's focus when brought to the front");
	const { targetId } = (await page.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
	let result: T | undefined;
	try {
		await waitUntil(async () => !(await focused()), "the second tab did not take the window's focus from the page");
		if (during) result = await during({ targetId });
	} finally {
		await page.send("Target.closeTarget", { targetId });
		const listed = async (): Promise<boolean> => ((await page.send("Target.getTargets")) as { targetInfos: { targetId: string }[] }).targetInfos.some((t) => t.targetId === targetId);
		await waitUntil(async () => !(await listed()), "the second tab did not leave Chrome's targets once closed");
		await page.send("Page.bringToFront");
	}
	await waitUntil(focused, "the page did not hold the window's focus again once the second tab was closed");
	return result;
}
