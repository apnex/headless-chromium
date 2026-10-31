// static-server - HC4 (CONTRACT.md): files and fixed pages served to a browser under test, every request recorded,
// and every connection, kept-alive ones among them, ended on close.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";

import { serveStatic } from "@apnex/headless-chromium";
import { scratchFolder } from "@apnex/clean-runner";
import { exitOf, ROOT } from "../support/helpers.js";

const TEST = { timeout: 30000 };

/** A folder holding the files a test serves. */
function site() {
	const root = scratchFolder("ss-");
	fs.mkdirSync(path.join(root, "app", "deep"), { recursive: true });
	fs.mkdirSync(path.join(root, "vendor"));
	fs.writeFileSync(path.join(root, "app", "index.html"), "<p>index</p>");
	fs.writeFileSync(path.join(root, "app", "main.js"), "export const a = 1;");
	fs.writeFileSync(path.join(root, "app", "deep", "style.css"), "p {}");
	fs.writeFileSync(path.join(root, "app", "data.bin"), "bin");
	fs.writeFileSync(path.join(root, "vendor", "part.mjs"), "export {};");
	fs.writeFileSync(path.join(root, "secret.txt"), "not served");
	fs.mkdirSync(path.join(root, "app2"));
	fs.writeFileSync(path.join(root, "app2", "beside.txt"), "not served either");
	return root;
}
const get = async (url, init) => {
	const res = await fetch(url, init);
	return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), body: await res.text(), headers: res.headers };
};

test("HC4: folders are served under their prefixes -- the longest first -- pages before folders, an index for a folder's path, a miss as 404", TEST, async () => {
	const root = site();
	const server = await serveStatic({ folders: { "/": path.join(root, "app"), "/vendor/part@1/": path.join(root, "vendor") }, pages: { "/": "<p>page</p>", "/data.json": { body: '{"a":1}', type: "application/json" } } });
	try {
		assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
		const page = await get(`${server.origin}/`);
		assert.deepEqual([page.status, page.type, page.cache, page.body], [200, "text/html; charset=utf-8", "no-store", "<p>page</p>"]);
		assert.equal((await get(`${server.origin}/data.json`)).body, '{"a":1}');
		assert.equal((await get(`${server.origin}/data.json`)).type, "application/json");
		assert.equal((await get(`${server.origin}/main.js`)).type, "text/javascript; charset=utf-8");
		assert.equal((await get(`${server.origin}/deep/style.css`)).type, "text/css; charset=utf-8");
		assert.equal((await get(`${server.origin}/deep/`)).status, 404, "a folder with no index is a miss");
		assert.equal((await get(`${server.origin}/data.bin`)).type, "application/octet-stream");
		assert.equal((await get(`${server.origin}/vendor/part@1/part.mjs`)).body, "export {};", "the longer prefix serves");
		assert.equal((await get(`${server.origin}/vendor/part@1/../../secret.txt`)).status, 404);
		assert.equal((await get(`${server.origin}/%2e%2e/secret.txt`)).status, 404, "no file outside its folder is served");
		assert.equal((await get(`${server.origin}/..%2fsecret.txt`)).status, 404);
		assert.equal((await get(`${server.origin}/..%2fapp2%2fbeside.txt`)).status, 404, "nor a file of a folder beside it whose name begins the same");
		const miss = await get(`${server.origin}/nothing.js`);
		assert.deepEqual([miss.status, miss.type, miss.body], [404, "text/plain; charset=utf-8", "not found"]);
	} finally {
		await server.close();
	}
	const indexed = await serveStatic({ folders: { "/": path.join(root, "app") } });
	const none = await serveStatic({ folders: { "/": path.join(root, "app") }, index: null });
	try {
		assert.equal((await get(`${indexed.origin}/`)).body, "<p>index</p>", "index.html serves a folder's path");
		assert.equal((await get(`${none.origin}/`)).status, 404, "unless index is null");
	} finally {
		await indexed.close();
		await none.close();
	}
});

test("HC4: every request answered is recorded, with its method, path, query and status; HEAD is answered with no body", TEST, async () => {
	const server = await serveStatic({ pages: { "/a": "a" } });
	try {
		await get(`${server.origin}/a?x=1`);
		await get(`${server.origin}/b`);
		const head = await fetch(`${server.origin}/a`, { method: "HEAD" });
		assert.equal(head.status, 200);
		assert.equal(await head.text(), "");
		assert.deepEqual(server.requests, [
			{ method: "GET", path: "/a", query: "?x=1", status: 200 },
			{ method: "GET", path: "/b", query: "", status: 404 },
			{ method: "HEAD", path: "/a", query: "", status: 200 },
		]);
	} finally {
		await server.close();
	}
});

test("HC4: a headers function adds headers to every answer, a miss among them, over the server's own; a function that throws is answered 500", TEST, async () => {
	const root = site();
	const told = [];
	const server = await serveStatic({
		folders: { "/": path.join(root, "app") },
		pages: { "/page": "p", "/main.js": { body: "export const page = 1;", type: "text/javascript" } },
		contentTypes: { ".bin": "application/x-planted" },
		headers: (request) => (told.push(request), request.path === "/boom" ? (() => { throw new Error("planted"); })() : { "x-rule": "on", "cache-control": request.status === 200 ? "max-age=60" : "no-store" }),
	});
	try {
		const hit = await get(`${server.origin}/deep/style.css`);
		assert.deepEqual([hit.headers.get("x-rule"), hit.cache], ["on", "max-age=60"]);
		assert.equal((await get(`${server.origin}/main.js`)).body, "export const page = 1;", "a page is served before a file of its path");
		const miss = await get(`${server.origin}/nope`);
		assert.deepEqual([miss.status, miss.headers.get("x-rule"), miss.cache], [404, "on", "no-store"]);
		assert.equal((await get(`${server.origin}/data.bin`)).type, "application/x-planted", "a content type of the caller's");
		await get(`${server.origin}/page`);
		assert.deepEqual(told, [
			{ method: "GET", path: "/deep/style.css", file: path.join(root, "app", "deep", "style.css"), status: 200 },
			{ method: "GET", path: "/main.js", file: null, status: 200 },
			{ method: "GET", path: "/nope", file: null, status: 404 },
			{ method: "GET", path: "/data.bin", file: path.join(root, "app", "data.bin"), status: 200 },
			{ method: "GET", path: "/page", file: null, status: 200 },
		]);
		const boom = await get(`${server.origin}/boom`);
		assert.deepEqual([boom.status, boom.body], [500, "serveStatic: the headers function threw: planted"]);
		assert.deepEqual(server.requests.at(-1), { method: "GET", path: "/boom", query: "", status: 500 });
	} finally {
		await server.close();
	}
});

test("HC4: close ends a connection whose request is still arriving at once, as a browser's can be", TEST, async () => {
	const server = await serveStatic({ pages: { "/": "x" } });
	const { port } = new URL(server.origin);
	const socket = net.connect(Number(port), "127.0.0.1");
	try {
		await new Promise((resolve) => socket.once("connect", resolve));
		socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n");
		await new Promise((resolve) => setTimeout(resolve, 100));
		const ended = new Promise((resolve) => socket.once("close", resolve));
		const started = Date.now();
		await server.close();
		await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 3000))]);
		assert.ok(socket.destroyed, "the connection is ended");
		assert.ok(Date.now() - started < 1000, `closed in ${Date.now() - started} ms, not held by the request still arriving`);
	} finally {
		// a connection the server failed to end must not hold this file open
		socket.destroy();
	}
});

test("HC4: close ends kept-alive connections at once and never throws, even twice; nothing answers after", TEST, async () => {
	const server = await serveStatic({ pages: { "/": "x" } });
	const agent = new http.Agent({ keepAlive: true });
	await new Promise((resolve, reject) => http.get(`${server.origin}/`, { agent }, (res) => res.resume().on("end", resolve)).on("error", reject));
	assert.equal(Object.values(agent.freeSockets).flat().length, 1, "control: a connection is kept alive");
	const started = Date.now();
	await server.close();
	assert.ok(Date.now() - started < 1000, `closed in ${Date.now() - started} ms, not held by the kept-alive connection`);
	assert.equal(await server.close(), undefined);
	await assert.rejects(fetch(`${server.origin}/`));
	agent.destroy();
});

test("HC4: a server never holds its process open, unless asked to", TEST, async () => {
	const body = (hold) => `import { serveStatic } from "@apnex/headless-chromium"; const s = await serveStatic({ hold: ${hold} }); process.stdout.write("up\\n");`;
	const free = spawn(process.execPath, ["--input-type=module", "-e", body(false)], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
	const held = spawn(process.execPath, ["--input-type=module", "-e", body(true)], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
	try {
		assert.deepEqual(await Promise.race([exitOf(free), new Promise((resolve) => setTimeout(resolve, 10000, "still running"))]), { code: 0, signal: null });
		await new Promise((resolve) => held.stdout.once("data", resolve));
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(held.exitCode, null, "a held server keeps its process running");
	} finally {
		free.kill("SIGKILL");
		held.kill("SIGKILL");
	}
	await exitOf(held);
});
