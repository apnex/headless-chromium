---
id: unminted
category: component
title: headless-chromium - drive headless Chromium for a test
status: draft
hydrate-when: A project's tests drive headless Chrome over the DevTools protocol, with trusted input, and must leave nothing of it behind
sovereignty: internal
supersedes: []
related: [C0, A3]
---

# headless-chromium

The contract of record for headless-chromium `0.1.0`, each rule stated on its own terms; what was settled at the build is in `docs/DECISIONS.md` (`D2`).\
It also carries the fields of a mission-kit registry entry, and that entry is generated from this file when the component is filed, never written as a second copy.\
The registry id is unminted on purpose; one is minted only when the entry is admitted to the registry.

---

## Duty

Drive headless Chromium for a test.

That is the whole duty: a headless Chrome a test launches, the DevTools session it drives the page through, the trusted input and focus loss it dispatches, and the pages it serves the browser, each gone without a trace when closed or when whatever started it dies.\
A started process's lifetime and its folders are `clean-runner`'s, taken through its public surface; this component does not run tests, decide what a test asserts, hold a project's pages, probes or fakes, or ship to a project's users.

---

## Contract

**Vocabulary.**\
These are the only nouns headless-chromium's source uses for what it handles.

| Word | Meaning |
|---|---|
| launch folder | `ch-XXXXXX` in the temporary folder, a Chrome's temporary folder, holding its lock folder and, unless one is given, its profile |
| lock folder | the folder Chrome makes in its temporary folder for its singleton socket, `.com.google.Chrome.XXXXXX` or `com.google.Chrome.XXXXXX` |
| lock socket | the singleton socket in the lock folder, whose path a socket address must hold |
| session | a DevTools protocol connection to one page of a Chrome |
| starter | the process that launched a Chrome, whose end ends it |

**Capabilities.**\
What a consumer can depend on, one capability per row.\
A capability is named for what it offers, not for who offers it, so two components that provide the same capability share its name, and the overlap is visible.\
**Provides** means this component implements the capability.\
**Requires** names the capabilities of other components a row depends on, as `component:capability`.\
The trait column names any trait a system takes on by using the capability.

| Capability | Relation | Requires | What a consumer can depend on | Trait |
|---|---|---|---|---|
| `chrome-launch` | provides | `clean-runner:tethered-process`, `clean-runner:scratch-folder` | Headless Chrome on a port the system gives it, in a launch folder of its own, gone without a trace when closed or when its starter dies; a temporary folder too long for its lock socket warned of, and its lock folder known in either spelling (HC1). | none |
| `devtools-session` | provides | none | A DevTools protocol session with a page: commands, events, evaluation, and no command left waiting on a browser that has gone (HC2). | none |
| `trusted-input` | provides | none | Trusted mouse input that names its held button, and focus lost to a second tab and given back (HC3). | none |
| `static-server` | provides | none | Files and fixed pages served to a browser under test, every request recorded, every connection ended on close (HC4). | none |

One capability per row; `chrome-launch` alone requires another component's capabilities, both of them `clean-runner`'s.

**Errors.**\
Every function reads and judges its arguments before it starts a process, makes a folder or opens a connection.\
A malformed argument is refused with a `TypeError` whose message begins with the function's name and a colon -- `launchChrome: ` -- thrown by a function that answers a value and rejected by one that answers a promise.\
A failure of the world, not of an argument -- a Chrome that exits before it writes its port, a page that throws, a command unanswered in time -- is an `Error`, the base constructor, its message beginning the same way, or with the protocol method's name for a session's command.\
A message's beginning is the contract and the rest is prose.\
Tested by: `test/contract/returned-values-and-errors.test.js`, and each capability's own file.

**What is returned.**\
A launched Chrome, a session and a mouse event's params are frozen objects whose keys are in the order written in the rule that makes them; the requests a server records are its own array, read-only in the types, which grows as it answers.\
Every function that waits waits a bounded time, and every close or stop is safe to call twice and never throws.\
Tested by: `test/contract/returned-values-and-errors.test.js` (I8), and each capability's own file.

**HC1 -- The Chrome launch.**\
`launchChrome(options)` starts headless Chrome and answers `{ pid, port, folder, profile, exited, close }` once Chrome has written its debugging port.
1. Chrome is `options.chrome`, else `findChrome()`: `$CHROME` when set and not empty, else the first executable file named `google-chrome`, `google-chrome-stable`, `chromium` or `chromium-browser` on `PATH`, else none, and launching refuses.
2. A launch folder, `ch-XXXXXX`, is made in the temporary folder as a clean-runner scratch folder, handed to the starter's warden before it is made; it is refused before either, with rule 9's warning as the message, when Chrome's lock socket in it would be longer than 107 characters.
3. Chrome is started through clean-runner's tether, `spawnTethered`, with the launch folder as its `TMPDIR` and `<launch folder>/config` as its `XDG_CONFIG_HOME` -- where its crash reporter keeps its settings and reports -- its streams discarded, and these flags, then `options.args`, then `--user-data-dir=<profile>`, `--remote-debugging-port=0` and `options.url`, `about:blank` by default: `--headless=new`, `--no-sandbox`, `--disable-gpu`, `--no-first-run`, `--no-default-browser-check`, `--disable-extensions`, `--disable-background-networking`, `--disable-component-update`, `--disable-sync`, `--metrics-recording-only`, `--password-store=basic`.
4. The profile is `options.profile`, a stale `DevToolsActivePort` in it removed first, else `profile` in the launch folder.
5. The port is the first line of the profile's `DevToolsActivePort`, read until `options.startTimeoutMs`, 20 seconds by default; a Chrome that exits first, or writes none in time, is refused, and closed.
6. `close()` stops Chrome's whole process group, with clean-runner's `stopGroup`, then removes the launch folder with its `removeScratchFolder`, which first stops every process naming the folder -- the crash handlers, which leave the group -- and then takes it back from the warden, so whatever later stands at its path is left alone; the lock folder in it, in either spelling, and the profile unless it is the caller's, go with it. A removal that fails -- a process no stop reaches, such as a crash handler whose rewritten title names the folder in no way clean-runner finds, still writing into it -- is tried again, what names the folder stopped again and the folder removed, until it is gone or 15 seconds have passed, when the warden still holds it; `close()` answers only then, and a refused launch (rule 5) rejects only then. `exited()` answers `{ code, signal }` once Chrome has ended, else `null`.
7. A launched Chrome never holds its starter open: a starter that ends without closing it ends, and the tether then stops Chrome and records it in the run.
8. However and whenever the starter ends -- before the launch folder exists, while Chrome starts or runs, or after Chrome has exited of itself, crashed or been closed by `Browser.close` -- the warden removes the launch folder, the lock folder and profile with it.
9. `lockSocketWarning(tmpdir)` answers `null` when Chrome's lock socket, in a launch folder made in `tmpdir` -- the temporary folder by default -- fits the 107 characters a socket address holds, and otherwise a warning naming the folder, the socket's length and the longest temporary folder that fits; a project may print it before its tests, judging the folder its tests will be given -- under clean-runner's runner, the run folder in its own.
10. `isLockFolderName(name)` answers whether a folder's name is the one Chrome gives its lock folder, `com.google.Chrome.` and six letters or digits, with one leading dot, as Chrome 136 names it, or none, as a later Chrome does; a folder so named left in a temporary folder is a Chrome started outside a launch folder of its own, or stopped without its removal.

`dumpDom(url, options)` loads the page in a one-shot Chrome, started as rule 3 starts one with `--virtual-time-budget=<options.virtualTimeBudgetMs>`, 10000 by default, and `--dump-dom`, its standard output written to a file in its launch folder, and answers the document Chrome wrote; a Chrome that exits other than with 0, or gives no answer within `options.timeoutMs`, 60 seconds by default, is refused; the launch folder is removed whatever happens, by `dumpDom` while its starter lives, tried again as rule 6 says before `dumpDom` answers, and by the warden, as rule 8 says, when it does not.\
So nothing Chrome makes outside a caller's profile can land beside another Chrome's or outlive it, whether it is closed or its starter dies; with its secrets kept in its profile, Chrome writes nothing to the user's login keyring, and with its configuration home in the launch folder, nothing to the user's crash reports, even when it crashes.\
Tested by: `test/contract/chrome-launch.test.js` (I1, I9, I10).

**HC2 -- The DevTools session.**\
`connectToPage(port, options)` finds the first target of type `page` that the Chrome on `port` lists, waiting up to `options.timeoutMs`, 10 seconds by default, connects to it over the runtime's global `WebSocket`, and answers `{ targetId, port, send, on, evaluate, close }`; a runtime with no global `WebSocket` is refused.
1. `send(method, params, sessionId)` answers the protocol's result, or rejects with an `Error` whose message begins with the method's name and holds the protocol's message; a `sessionId` sends the command to the target a flattened `Target.attachToTarget` named.
2. `on(method, listener)` hands every event named `method` to the listener, with the event's `sessionId` when an attached target sent it, and answers a function that stops it; a listener that throws stops nothing else.
3. `evaluate(expression)` answers the expression's value, returned by value and a promise awaited, or rejects with an `Error` beginning `evaluate: the page threw: ` and what the page threw.
4. A command unanswered within `options.commandTimeoutMs`, 15 seconds by default, rejects; `close()` rejects every command still waiting at once, the socket closing under the session rejects them as soon as it is seen, and either rejects every later one.

Tested by: `test/contract/devtools-session.test.js` (I2).

**HC3 -- Trusted input.**\
`BUTTON_NAMES` holds the protocol's names of the five mouse buttons by button number, `left`, `middle`, `right`, `back` and `forward`, and `BUTTON_BITS` each one's bit in a pointer event's `buttons`, 1, 4, 2, 8 and 16; both are frozen.
1. `heldButtonName(buttons)` answers the name of the lowest-numbered button `buttons` holds, or `none`, for an integer from 0 to 31.
2. `mouseEventParams(type, point, options)` answers the params of one `Input.dispatchMouseEvent` command, `{ type, x, y, button, buttons, clickCount, modifiers, pointerType }`: `type` one of `mousePressed`, `mouseReleased` and `mouseMoved`; `button` as given, else, for a move, `heldButtonName(buttons)`, else `none`; `buttons` 0, `clickCount` 1 for a press or a release and 0 for a move, `modifiers` 0 and `pointerType` `mouse` unless given.
3. `loseFocus(page, during, options)` brings the page to the front and waits until it holds the window's focus, opens a second tab and waits until the page has lost it, runs `during({ targetId })`, then closes the tab, waits until Chrome no longer lists it, brings the page to the front, and waits until it holds the focus again; it answers what `during` answered, and when `during` throws it still closes the tab and gives the focus back, then throws what `during` threw; each wait is bounded by `options.timeoutMs`, 5 seconds by default, and one that runs out is an `Error` naming the step.

Chrome drops a pointer the page has taken -- its capture lost at once -- on a move whose `button` is `none` while `buttons` holds a bit, so a move made by rule 2 keeps it.\
A page focused by input alone keeps the focus through a second tab, with no blur; brought to the front first, it loses it to one.\
Tested by: `test/contract/trusted-input.test.js` (I3).

**HC4 -- The static server.**\
`serveStatic(options)` listens on `127.0.0.1` on a port the system gives it and answers `{ origin, requests, close }`.
1. A request's path, decoded, is answered by the page `options.pages` holds for it, a string served as HTML or a `{ body, type }`; else by the file under the folder of the longest prefix in `options.folders` it begins with, `options.index`, `index.html` by default, serving a path ending in `/`; never by a file outside its folder, nor of a folder beside it whose name begins the same; else 404 and `not found`.
2. Every answer carries its content type -- the page's, or the file's by its extension from the server's table under `options.contentTypes` -- and `cache-control: no-store`, under what `options.headers` answers for `{ method, path, file, status }`; a headers function that throws is answered 500.
3. `HEAD` is answered with no body; every request answered is recorded in `requests` as `{ method, path, query, status }`, in order.
4. The server never holds its process open unless `options.hold` is true; `close()` ends every connection -- kept-alive ones, and ones whose request is still arriving, among them -- and waits at most two seconds for the server to close.

Tested by: `test/contract/static-server.test.js` (I4).

**HC5 -- Exports, dependency and platform.**\
`@apnex/headless-chromium` exports the twelve names HC1 to HC4 name, and nothing else, from its one path; it has no command, since the runner is `clean-runner`'s.\
Its one runtime dependency is `@apnex/clean-runner` `0.2.0`, pinned to its release file by its URL and, in the lockfile, by its hash, and reached through its public exports alone -- `spawnTethered`, `stopGroup`, `scratchFolder` and `removeScratchFolder` -- for a started Chrome's lifetime and its folders: its built files import only each other, the runtime's built-in modules and `@apnex/clean-runner` by its bare name, never a path into it, and name no global but those the build uses.\
Its platform is the runtime, version 22.4 or later -- the first to hold the global `WebSocket` -- on Linux, as `clean-runner`'s is.\
Its types are written against the runtime's own types, which a consumer's tests compile against.\
Tested by: `test/contract/public-surface.test.js`, `test/contract/public-types.test.js` (I5), the source check (`tools/check-source.mjs`), the runtime check (`tools/check-runtime.mjs`), the export-map check (`tools/check-export-map.mjs`) and the consumer test (`tools/consumer-test.mjs`).

**Invariants.**\
There is no conformance kit: nothing in headless-chromium is a port another party implements.\
*headless-chromium* marks what the component's own tests hold; *gate* what its gate holds.

| # | Invariant | Held by |
|---|---|---|
| I1 | Chrome is launched with the shared flags on the port it wrote, its lock folder in its launch folder; closing it ends its group and its crash handlers and removes the launch folder, the user's login keyring and crash reports left as they were; a starter that ends without closing it ends, and its run names the Chrome; a caller's profile is kept and launched on again; a lock folder in either spelling is removed on close and on its starter's death; `findChrome` answers `CHROME`, then `PATH`, then `null`; a Chrome that exits first or writes no port, and a temporary folder too long, are refused, nothing left; `dumpDom` answers the settled page, and refuses a failing or silent Chrome, nothing left; a Chrome closed by `Browser.close` or crashed before its starter is killed -- its crash report written in its launch folder and none in the user's -- a `dumpDom` whose starter is killed the moment its Chrome exits, and a `launchChrome` or `dumpDom` whose starter is killed at any of nine moments from its first, leave nothing. | headless-chromium |
| I2 | A session answers commands and evaluations, refuses a protocol error with the method's name first and a page's throw with what it threw, hands out events until stopped, sends to an attached tab by its `sessionId`, and rejects what waits when closed -- at once -- when Chrome dies, and when no answer comes in time; a Chrome with no page and a runtime with no `WebSocket` are refused. | headless-chromium |
| I3 | `heldButtonName` answers every value from 0 to 31 as its lowest-numbered held button; `mouseEventParams` defaults as HC3 says and keeps what it is told; in Chrome, a taken pointer survives moves naming each held button and is lost by one naming none; `loseFocus` makes one blur, runs `during` with the focus lost, gives the focus back with the tab gone, and does so when `during` throws. | gate |
| I4 | The server serves pages before folders and the longest prefix first, never a file outside its folder, nor of a folder beside it whose name begins the same, with content types, headers of the caller's and 500 for a throwing headers function; it records every request; it ends a kept-alive connection, and one whose request is still arriving, on close at once; it holds its process open only when asked. | headless-chromium |
| I5 | A consumer compiled with `tsc --noEmit` under strict settings, with and without `exactOptionalPropertyTypes`, uses every export, and eleven lines that misuse one fail to compile, each on its own line alone. | headless-chromium |
| I6 | The source names no consumer's vocabulary and declares no global; the program compiles nothing but the source, the language's and the runtime's types and the runtime dependency's declarations; the built files import only each other, the runtime's built-in modules and `@apnex/clean-runner` by its bare name, and name no global the build does not use; no file and no commit message holds a run of sixteen hex digits but an action's pin. | gate |
| I7 | The repository's gate runs its tests under `clean-runner`'s runner, and the run leaves nothing behind. | gate |
| I8 | Every function refuses a malformed argument with a `TypeError` beginning with its name, an async one by rejecting, before it starts or makes anything; a failure of the world is an `Error` beginning the same way. | headless-chromium |
| I9 | A starter killed by SIGKILL after launching Chrome, starting a server and making a scratch folder leaves none of them after a bounded wait; a launch folder its Chrome's close has removed is taken back from the warden, so a folder later made at its path outlives the starter; a launch folder a late writer no stop reaches still fills when it is first removed is gone before a launch is refused, whether Chrome exited or wrote no port in time, before a Chrome's close answers, and before `dumpDom` answers. | headless-chromium |
| I10 | `lockSocketWarning` warns of a temporary folder whose lock socket would be 108 characters and not of one at 107, naming the longest that fits, and the launcher refuses with the same words; `isLockFolderName` answers both spellings and nothing near them; a test that ends with its Chrome running fails its run under `clean-runner`'s runner, which names the test and the Chrome, and nothing of it survives. | headless-chromium |

I3's Chrome half and I7 are held by the gate, which runs the real-Chrome tests under `clean-runner`'s runner; I6 by `tools/check-vocabulary.mjs`, `tools/check-source.mjs`, `tools/check-runtime.mjs` and `tools/check-public-text.mjs`, whose own tests are `test/tools/gate-checks.test.js`; I7 by `package.json`'s `test` script, held by `test/contract/public-surface.test.js`.

---

## Reference

This repository, `apnex/headless-chromium`, and its package `@apnex/headless-chromium`, released only by its own CI as a tarball attached to a GitHub release, drafted, verified and then published (`.github/workflows/release.yml`).\
The package exports the twelve names HC5 counts from its one path, as `export-map.json` records.\
The code is TypeScript in `src/`, built to `dist/`, which only a release holds.\
The tests are in `test/`: one file per capability in `test/contract/`, with `returned-values-and-errors.test.js`, `public-types.test.js`, `public-surface.test.js` and `contract-coverage.test.js` beside them; a fake Chrome and a planted test file in `test/fixtures/`; I5's consumer in `test/types/`; what the tests share in `test/support/`; and the gate checks' own tests in `test/tools/`.\
The gate, `npm run gate`, builds, runs the tests under `clean-runner`'s runner -- the real-Chrome tests among them -- then the vocabulary, source, runtime, export-map and public-text checks in `tools/`, and mission-kit's style checks.\
It was built under draw's ruling `H26-19` as amended, which is kept in draw's records, `apnex/drawv2`.

---

## Fit criteria

**Does my project want this at all?**
- A project's tests drive headless Chrome over the DevTools protocol, with trusted input, and nothing of the browser may outlive them, even when a test is killed.
- A project's tests serve pages to that browser and count what it asks for.
- A project's consumer test loads its package in a one-shot Chrome.

**It is the wrong tool when:**

| You need | Reach elsewhere, because headless-chromium is |
|---|---|
| a run that fails on anything left, or processes and folders tied to a test | not the runner: `clean-runner` holds that, and this component takes it |
| a browser automation library with selectors and waits | not a page driver: it hands a session and the input traps, and a page's own steps are the project's |
| Firefox, WebKit, or a browser with a window | headless Chromium only |
| a project's pages, probes or fakes | not a fixture library: those stay in the project |
| anything shipped to a project's users | test-only: a project takes it as a development dependency, pinned to its release file |
| Windows or macOS | Linux only, as `clean-runner` is |

---

## Adjustment policy

Internal and sovereign: a measured gap is recorded where both sides can see it, then resolved by adjusting headless-chromium or by fracturing it if the gap reveals a second duty; never forked.\
A gap in a started process's lifetime or its folders is `clean-runner`'s to close, and is taken from its next release, never worked around here.

---

## Edges

**Contains:** the Chrome launch, the lock socket's and lock folder's knowledge, the DevTools session, the trusted-input helpers, the static server.\
**Consumes:** `clean-runner`, its tethered processes and scratch folders, through its public exports.\
**Consumed-by:** draw, `snap-grid`, `input-binding`, `input-capture`, `vector-scene` and `input-tester`, each in its tests alone.
