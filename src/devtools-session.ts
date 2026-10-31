// devtools-session - a DevTools protocol session with a page of a Chrome, over the runtime's global WebSocket, with
// no dependency (CONTRACT.md HC2).
//
// send(method, params, sessionId) answers the protocol's result or rejects with its error; a sessionId sends to a
// target a flattened Target.attachToTarget named, as a second tab is driven. on(method, listener) hands every event
// of that method to the listener. evaluate(expression) answers the expression's value, awaiting a promise. A command
// unanswered within its bound rejects, and close() -- or the socket closing under it, Chrome having gone -- rejects
// every command still waiting, so no test hangs on a browser that has died.

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A listener for one protocol event: its params, and the sessionId of the attached target that sent it, if any. */
export type ProtocolListener = (params: any, sessionId: string | undefined) => void;

export interface PageSession {
	/** The page target's id. */
	readonly targetId: string;
	/** The debugging port the session was opened on. */
	readonly port: number;
	/** Sends one command, to the page or to the attached target `sessionId` names; answers the protocol's result. */
	send(method: string, params?: object, sessionId?: string): Promise<any>;
	/** Hands every event named `method` to `listener`; answers a function that stops it. */
	on(method: string, listener: ProtocolListener): () => void;
	/** Evaluates an expression in the page, awaiting a promise it answers, and answers its value. */
	evaluate(expression: string): Promise<unknown>;
	/** Closes the socket and rejects every command still waiting; never throws, and a second call does nothing. */
	close(): void;
}

export interface SessionOptions {
	/** How long the page target may take to appear and the socket to open, in milliseconds; 10000 by default. */
	readonly timeoutMs?: number;
	/** How long a command may wait for its answer, in milliseconds; 15000 by default. */
	readonly commandTimeoutMs?: number;
}

interface Waiting {
	readonly method: string;
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

const readBound = (key: string, value: unknown, fallback: number): number => {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`connectToPage: ${key} must be a positive number of milliseconds`);
	return value;
};

/** Finds the first page target of the Chrome listening on `port`, waiting for one to appear. */
async function findPageTarget(port: number, until: number): Promise<{ id: string; webSocketDebuggerUrl: string }> {
	let last = "no answer";
	while (Date.now() < until) {
		try {
			const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type?: unknown; id?: unknown; webSocketDebuggerUrl?: unknown }[];
			const page = targets.find((t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string" && typeof t.id === "string");
			if (page) return page as { id: string; webSocketDebuggerUrl: string };
			last = `${targets.length} target(s), none a page`;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		await sleep(50);
	}
	throw new Error(`connectToPage: no page target on port ${port} in time (${last})`);
}

/** Opens a DevTools protocol session with the first page of the Chrome whose debugging port is `port`. */
export async function connectToPage(port: number, options: SessionOptions = {}): Promise<PageSession> {
	if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new TypeError(`connectToPage: the port must be an integer from 1 to 65535, not ${String(port)}`);
	if (options === null || typeof options !== "object") throw new TypeError("connectToPage: options must be an object");
	const timeoutMs = readBound("timeoutMs", options.timeoutMs, 10000);
	const commandTimeoutMs = readBound("commandTimeoutMs", options.commandTimeoutMs, 15000);
	if (typeof WebSocket !== "function") throw new Error("connectToPage: this runtime has no global WebSocket; version 22.4 and later hold one");
	const until = Date.now() + timeoutMs;
	const target = await findPageTarget(port, until);
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`connectToPage: the socket to ${target.webSocketDebuggerUrl} did not open in time`));
			try {
				socket.close();
			} catch {
				// not open
			}
		}, Math.max(1, until - Date.now()));
		socket.addEventListener("open", () => (clearTimeout(timer), resolve()), { once: true });
		socket.addEventListener("error", () => (clearTimeout(timer), reject(new Error(`connectToPage: could not open the socket to ${target.webSocketDebuggerUrl}`))), { once: true });
	});

	let next = 0;
	let closed = false;
	const pending = new Map<number, Waiting>();
	const listeners = new Map<string, Set<ProtocolListener>>();
	const failAll = (why: string): void => {
		for (const [id, waiting] of pending) {
			pending.delete(id);
			clearTimeout(waiting.timer);
			waiting.reject(new Error(`${waiting.method}: ${why}`));
		}
	};
	socket.addEventListener("message", (event) => {
		let data: { id?: unknown; method?: unknown; params?: unknown; sessionId?: unknown; result?: unknown; error?: { message?: unknown } };
		try {
			data = JSON.parse(String(event.data));
		} catch {
			return;
		}
		if (typeof data.id !== "number") {
			if (typeof data.method !== "string") return;
			for (const listener of [...(listeners.get(data.method) ?? [])]) {
				try {
					listener(data.params, typeof data.sessionId === "string" ? data.sessionId : undefined);
				} catch {
					// a listener's error is its own; the session goes on
				}
			}
			return;
		}
		const waiting = pending.get(data.id);
		if (!waiting) return;
		pending.delete(data.id);
		clearTimeout(waiting.timer);
		if (data.error) waiting.reject(new Error(`${waiting.method}: ${String(data.error.message)}`));
		else waiting.resolve(data.result);
	});
	socket.addEventListener("close", () => {
		closed = true;
		failAll("the session closed");
	});

	const send = (method: string, params: object = {}, sessionId?: string): Promise<any> => {
		if (typeof method !== "string" || method === "") return Promise.reject(new TypeError("send: the method must be a non-empty string"));
		if (params === null || typeof params !== "object" || Array.isArray(params)) return Promise.reject(new TypeError(`send: the params of ${method} must be an object`));
		if (sessionId !== undefined && typeof sessionId !== "string") return Promise.reject(new TypeError(`send: the sessionId of ${method} must be a string`));
		if (closed) return Promise.reject(new Error(`${method}: the session is closed`));
		return new Promise((resolve, reject) => {
			const id = ++next;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`${method}: no answer within ${commandTimeoutMs} ms`));
			}, commandTimeoutMs);
			pending.set(id, { method, resolve, reject, timer });
			socket.send(JSON.stringify(sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }));
		});
	};
	const on = (method: string, listener: ProtocolListener): (() => void) => {
		if (typeof method !== "string" || method === "") throw new TypeError("on: the method must be a non-empty string");
		if (typeof listener !== "function") throw new TypeError(`on: the listener for ${method} must be a function`);
		const set = listeners.get(method) ?? new Set<ProtocolListener>();
		listeners.set(method, set);
		set.add(listener);
		return () => void set.delete(listener);
	};
	const evaluate = async (expression: string): Promise<unknown> => {
		if (typeof expression !== "string") throw new TypeError("evaluate: the expression must be a string");
		const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (exceptionDetails) throw new Error(`evaluate: the page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
		return result.value;
	};
	const close = (): void => {
		if (closed) return;
		closed = true;
		try {
			socket.close();
		} catch {
			// already closing
		}
		failAll("the session closed");
	};
	return Object.freeze({ targetId: target.id, port, send, on, evaluate, close });
}
