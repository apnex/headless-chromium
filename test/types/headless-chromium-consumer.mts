// headless-chromium-consumer - I5 (CONTRACT.md HC5): a consumer of the published types, compiled by
// test/contract/public-types.test.js under strict settings, with and without exactOptionalPropertyTypes. Each line
// after an expected-error directive must fail to compile, and only it.
import { BUTTON_BITS, BUTTON_NAMES, connectToPage, dumpDom, findChrome, heldButtonName, isLockFolderName, launchChrome, lockSocketWarning, loseFocus, mouseEventParams, serveStatic, type ButtonName, type LaunchedChrome, type MouseEventParams, type PageSession, type ServedRequest, type StaticServer } from "@apnex/headless-chromium";

export async function consume(): Promise<void> {
	const warning: string | null = lockSocketWarning("/tmp");
	const lock: boolean = isLockFolderName(".com.google.Chrome.Ab12Cd");
	void [warning, lock];

	const found: string | null = findChrome();
	const chrome: LaunchedChrome = await launchChrome({ url: "about:blank", args: ["--window-size=800,600"], ...(found === null ? {} : { chrome: found }) });
	const port: number = chrome.port;
	const startMs: number = chrome.startMs;
	void startMs;
	const exited = chrome.exited();
	if (exited !== null) void [exited.code, exited.signal];
	const page: PageSession = await connectToPage(port, { commandTimeoutMs: 1000 });
	const answer = await page.send("Runtime.evaluate", { expression: "1" });
	void answer.result;
	const stop: () => void = page.on("Page.loadEventFired", (params, sessionId) => void [params, sessionId]);
	stop();
	const value: unknown = await page.evaluate("document.title");
	void value;
	const name: ButtonName | "none" = heldButtonName(BUTTON_BITS[2]);
	const named: ButtonName = BUTTON_NAMES[0];
	const params: MouseEventParams = mouseEventParams("mouseMoved", { x: 1, y: 2 }, { buttons: 1 });
	await page.send("Input.dispatchMouseEvent", params);
	const during: string | undefined = await loseFocus(page, async ({ targetId }) => targetId, { timeoutMs: 1000 });
	void [name, named, during];
	page.close();
	await chrome.close();
	const dom: string = await dumpDom("about:blank", { virtualTimeBudgetMs: 100 });
	void dom;

	const folder = "/tmp";
	const server: StaticServer = await serveStatic({ folders: { "/": folder }, pages: { "/": "<p>x</p>", "/a.json": { body: "{}", type: "application/json" } }, headers: ({ path, status }) => ({ "x-path": `${path} ${status}` }), index: null, hold: false });
	const requests: readonly ServedRequest[] = server.requests;
	void requests;
	await server.close();

	// @ts-expect-error -- a mouse event type the protocol has no such name for
	mouseEventParams("click", { x: 1, y: 2 });
	// @ts-expect-error -- a button the protocol has no such name for
	mouseEventParams("mousePressed", { x: 1, y: 2 }, { button: "top" });
	// @ts-expect-error -- the params made are read-only
	params.x = 3;
	// @ts-expect-error -- the button names are read-only
	BUTTON_NAMES.push("left");
	// @ts-expect-error -- a Chrome's port is read-only
	chrome.port = 9222;
	// @ts-expect-error -- args is an array of strings
	await launchChrome({ args: "--window-size=800,600" });
	// @ts-expect-error -- the requests a server answered are read-only
	server.requests.push({ method: "GET", path: "/", query: "", status: 200 });
	// @ts-expect-error -- a page is a string or a body and its type
	await serveStatic({ pages: { "/": 1 } });
	// @ts-expect-error -- heldButtonName answers a button's name or none
	if (heldButtonName(1) === "top") void 0;
	// @ts-expect-error -- lockSocketWarning answers a warning or null
	const always: string = lockSocketWarning();
	// @ts-expect-error -- isLockFolderName takes a name
	isLockFolderName(1);
	void always;
}
