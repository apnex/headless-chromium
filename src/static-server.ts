// static-server - a server of files and fixed pages for a browser under test (CONTRACT.md HC4).
//
// It listens on 127.0.0.1, on a port the system gives it, and never holds the process open unless asked to. It
// records every request it answers, so a test can hold the browser's own account of its requests against a second
// witness. close() ends every connection, kept-alive ones among them -- which would otherwise hold the process,
// and the run, open until they time out -- waits a bounded time for the server to close, and never throws.
import * as fs from "fs";
import * as http from "http";
import * as path from "path";

/** A fixed page: its body, and the content type it is served with. */
export interface StaticPage {
	readonly body: string | Uint8Array;
	readonly type: string;
}

/** One request the server answered. */
export interface ServedRequest {
	readonly method: string;
	readonly path: string;
	readonly query: string;
	readonly status: number;
}

/** What a header function is told of a request it adds headers to: the file served, null for a page or a miss. */
export interface HeaderContext {
	readonly method: string;
	readonly path: string;
	readonly file: string | null;
	readonly status: number;
}

export interface StaticServerOptions {
	/** URL prefixes, each beginning and ending with "/", mapped to the folder their files are served from; the longest matching prefix serves. */
	readonly folders?: Readonly<Record<string, string>>;
	/** Exact paths answered with a fixed page, before any folder. */
	readonly pages?: Readonly<Record<string, string | StaticPage>>;
	/** Headers added to every answer, a miss among them, over the content type and `cache-control: no-store`. */
	readonly headers?: (request: HeaderContext) => Readonly<Record<string, string>>;
	/** Content types by extension, ".js" and the like, over the server's own table. */
	readonly contentTypes?: Readonly<Record<string, string>>;
	/** The file a path ending in "/" serves; "index.html" by default, null for none. */
	readonly index?: string | null;
	/** Hold the process open while the server listens; false by default. */
	readonly hold?: boolean;
}

export interface StaticServer {
	/** `http://127.0.0.1:<port>`, with no trailing "/". */
	readonly origin: string;
	/** Every request answered so far, in order. */
	readonly requests: readonly ServedRequest[];
	/** Ends every connection and closes the server, waiting at most two seconds; never throws, and a second call does nothing. */
	close(): Promise<void>;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".map": "application/json",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".png": "image/png",
	".ico": "image/x-icon",
	".wasm": "application/wasm",
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function readOptions(options: StaticServerOptions): { folders: [string, string][]; pages: Map<string, StaticPage>; types: Record<string, string> } {
	if (!isRecord(options)) throw new TypeError("serveStatic: options must be an object");
	const folders: [string, string][] = [];
	if (options.folders !== undefined) {
		if (!isRecord(options.folders)) throw new TypeError("serveStatic: folders must be an object of URL prefixes and folders");
		for (const [prefix, folder] of Object.entries(options.folders)) {
			if (!prefix.startsWith("/") || !prefix.endsWith("/")) throw new TypeError(`serveStatic: the folder prefix ${JSON.stringify(prefix)} must begin and end with "/"`);
			if (typeof folder !== "string" || folder === "") throw new TypeError(`serveStatic: the folder for ${prefix} must be a path`);
			folders.push([prefix, path.resolve(folder)]);
		}
	}
	folders.sort((a, b) => b[0].length - a[0].length);
	const pages = new Map<string, StaticPage>();
	if (options.pages !== undefined) {
		if (!isRecord(options.pages)) throw new TypeError("serveStatic: pages must be an object of paths and pages");
		for (const [at, page] of Object.entries(options.pages)) {
			if (!at.startsWith("/")) throw new TypeError(`serveStatic: the page path ${JSON.stringify(at)} must begin with "/"`);
			if (typeof page === "string") pages.set(at, { body: page, type: CONTENT_TYPES[".html"] ?? "" });
			else if (isRecord(page) && (typeof page.body === "string" || page.body instanceof Uint8Array) && typeof page.type === "string") pages.set(at, { body: page.body, type: page.type });
			else throw new TypeError(`serveStatic: the page at ${at} must be a string or { body, type }`);
		}
	}
	if (options.headers !== undefined && typeof options.headers !== "function") throw new TypeError("serveStatic: headers must be a function");
	if (options.contentTypes !== undefined && !isRecord(options.contentTypes)) throw new TypeError("serveStatic: contentTypes must be an object of extensions and types");
	if (options.index !== undefined && options.index !== null && (typeof options.index !== "string" || options.index === "" || options.index.includes("/"))) throw new TypeError("serveStatic: index must be a file name or null");
	return { folders, pages, types: { ...CONTENT_TYPES, ...(options.contentTypes as Record<string, string> | undefined) } };
}

/** The file a path names under the folders, or null when none holds it; never a file outside its folder. */
function fileFor(folders: readonly [string, string][], urlPath: string, index: string | null): string | null {
	for (const [prefix, folder] of folders) {
		if (!urlPath.startsWith(prefix)) continue;
		let rel = urlPath.slice(prefix.length);
		if (rel === "" || rel.endsWith("/")) {
			if (index === null) return null;
			rel += index;
		}
		const file = path.resolve(folder, rel);
		if (!file.startsWith(folder + path.sep)) return null;
		try {
			return fs.statSync(file).isFile() ? file : null;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Serves fixed pages and the files of folders on 127.0.0.1, on a port the system gives it. Answers its origin, the
 * requests it has answered, and close().
 */
export async function serveStatic(options: StaticServerOptions = {}): Promise<StaticServer> {
	const { folders, pages, types } = readOptions(options);
	const index = options.index === undefined ? "index.html" : options.index;
	const requests: ServedRequest[] = [];
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const method = req.method ?? "GET";
		let urlPath: string;
		try {
			urlPath = decodeURIComponent(url.pathname);
		} catch {
			urlPath = url.pathname;
		}
		const page = pages.get(urlPath);
		const file = page ? null : fileFor(folders, urlPath, index);
		const status = page || file ? 200 : 404;
		const type = page ? page.type : file ? (types[path.extname(file).toLowerCase()] ?? "application/octet-stream") : "text/plain; charset=utf-8";
		let headers: Record<string, string> = { "content-type": type, "cache-control": "no-store" };
		try {
			if (options.headers) headers = { ...headers, ...options.headers({ method, path: url.pathname, file, status }) };
		} catch (error) {
			// the caller's function threw: answered, and recorded, as the server's own failure rather than ending the process
			requests.push({ method, path: url.pathname, query: url.search, status: 500 });
			res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
			res.end(`serveStatic: the headers function threw: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		requests.push({ method, path: url.pathname, query: url.search, status });
		res.writeHead(status, headers);
		// the runtime's server sends no body for HEAD, whatever is written
		res.end(page ? page.body : file ? fs.readFileSync(file) : "not found");
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	if (options.hold !== true) server.unref();
	const address = server.address();
	const port = address !== null && typeof address === "object" ? address.port : 0;
	let closing: Promise<void> | null = null;
	const close = (): Promise<void> => {
		closing ??= (async () => {
			try {
				server.closeAllConnections();
				await Promise.race([new Promise<void>((resolve) => server.close(() => resolve())), new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);
			} catch {
				// close() never throws: a server that will not close is left to the process's end
			}
		})();
		return closing;
	};
	return { origin: `http://127.0.0.1:${port}`, requests, close };
}
