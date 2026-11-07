# headless-chromium

Drive headless Chromium for a test: a Chrome on a port the system gives it, in a folder of its own, a DevTools session with trusted input and focus loss, and a static server -- each gone without a trace when closed or when whatever started it dies.

---

## Install

headless-chromium is released only as a tarball attached to a GitHub release, made by its own CI, so a project names the release file and its lockfile pins the file's hash.\
It is used by tests alone, so it is a development dependency, and nothing of it reaches a project's users.

Choose a release from the repository's Releases page, `https://github.com/apnex/headless-chromium/releases`, and name its file in your `package.json`, writing that release's version for `<version>`:
```json
"devDependencies": {
  "@apnex/headless-chromium": "https://github.com/apnex/headless-chromium/releases/download/v<version>/apnex-headless-chromium-<version>.tgz"
}
```

Then install, which records the file's `integrity` in `package-lock.json`, so every `npm ci` refuses a file whose hash differs:
```bash
npm install
```

It brings `@apnex/clean-runner`, its one dependency, pinned the same way, which ties every Chrome and folder it makes to the process that made it, and gives you the runner your tests run under.\
It needs Node.js 22.4 or later, on Linux, and a Chrome: `google-chrome` or `chromium` on `PATH`, or `CHROME` naming one.

---

## Use

Run your tests under `clean-runner`'s runner, as its README says, then drive Chrome in them; each Chrome, session and server ends with the test that made it, however the test ends.\
This section is the whole surface; `CONTRACT.md` gives every rule, HC1 to HC5.

### Driving Chrome

Launch headless Chrome, open a session with its page, and close both:
```js
import { connectToPage, launchChrome } from "@apnex/headless-chromium";

const chrome = await launchChrome({ args: ["--window-size=800,600"] });
const page = await connectToPage(chrome.port);
await page.send("Page.navigate", { url: `${server.origin}/` });
const title = await page.evaluate("document.title");
page.close();
await chrome.close();
```

Chrome runs in a folder of its own, `ch-XXXXXX`, which holds its lock folder and its profile; `close()` stops its whole process group and removes the folder; and if the test ends first -- before Chrome started, while it runs, or after it exited or crashed -- its tether stops Chrome and the test's warden removes the folder.\
Chrome's crash reporter keeps its settings and reports in that folder too, so a Chrome that crashes in a test writes nothing to your own `~/.config/google-chrome/Crash Reports`.\
A Chrome never holds the test's process open: a test that forgets to close it ends, and the run then names the Chrome its tether had to stop.\
Chrome has 60 seconds to write its debugging port, or `startTimeoutMs` milliseconds, and `chrome.startMs` says how long its start took; a start that runs past the bound is refused saying whether Chrome exited, with its exit code, was still starting and ended when asked -- a slow start -- or did not end until it was killed -- a hung one.\
Name a profile of your own with `profile` to keep it across launches.\
`dumpDom(url)` loads a page in a one-shot Chrome and answers the document it settles to.

Chrome needs its lock socket's path to fit a socket address, 107 characters, so a temporary folder too long for it is refused, with a message naming the longest that fits.\
Warn of it before your tests instead, judging the folder they will be given -- under `clean-runner`'s runner, a run folder in yours:
```js
import os from "node:os";
import path from "node:path";
import { lockSocketWarning } from "@apnex/headless-chromium";

const warning = lockSocketWarning(path.join(os.tmpdir(), "cr-run-XXXXXX"));
if (warning !== null) console.warn(warning);
```

`isLockFolderName(name)` answers whether a folder is a lock folder Chrome made, in either spelling, as a run's leftovers may name one: a Chrome started outside a launch folder of its own, or stopped without its removal.

### Trusted input

Dispatch mouse input so that a move names the button it holds, which Chrome needs to keep a pointer the page has taken:
```js
import { mouseEventParams } from "@apnex/headless-chromium";

await page.send("Input.dispatchMouseEvent", mouseEventParams("mousePressed", { x: 40, y: 40 }, { button: "left", buttons: 1 }));
await page.send("Input.dispatchMouseEvent", mouseEventParams("mouseMoved", { x: 60, y: 40 }, { buttons: 1 }));
```

Take the window's focus away with a second tab, act while it is gone, and give it back:
```js
import { loseFocus } from "@apnex/headless-chromium";

await loseFocus(page, async ({ targetId }) => {
  // the page has seen its blur here
});
```

`heldButtonName(buttons)`, `BUTTON_NAMES` and `BUTTON_BITS` give the protocol's names and a pointer event's bits for the five buttons.

### Serving pages

Serve fixed pages and folders to the browser, every request recorded, every connection ended on close:
```js
import { serveStatic } from "@apnex/headless-chromium";

const server = await serveStatic({ pages: { "/": "<!doctype html><title>t</title>" }, folders: { "/dist/": "dist" } });
await server.close();
```

### Errors

A malformed argument is a `TypeError` whose message begins with the function's name and a colon; a failure of the world -- a Chrome that never wrote its port, a page that threw -- is an `Error` beginning the same way.

---

## Test

The gate builds, then runs every test under `clean-runner`'s runner -- among them tests in headless Chrome, and tests that kill a starter by SIGKILL and find nothing left -- then the vocabulary, source, runtime, export-map and public-text checks, and mission-kit's style checks over the Markdown.

Run the gate with a mission-kit checkout beside this repository, or with `MISSION_KIT` naming one, with `google-chrome` on `PATH` or `CHROME` naming a Chrome, and with a `TMPDIR` short enough for Chrome's lock socket beneath a run folder:
```bash
npm ci
npm run gate
```

The consumer test packs the package, installs the file into an empty project, imports every export by name, and drives a page in headless Chrome through the installed package, under the installed `clean-runner`:
```bash
npm run consumer
```

The built size is measured after a build:
```bash
node tools/measure-size.mjs
```

---

## Remove

Stop driving Chrome in the tests, then remove the dependency, and with it the lockfile's entry:
```bash
npm uninstall @apnex/headless-chromium
```

---

## Status

Experimental until mission-kit admits it; it runs in the Node.js versions `package.json`'s `engines` names, on Linux.

---

## Documents

- `VISION.md` - why it exists, and what it will never be.
- `CONTRACT.md` - what a project can depend on, one capability per row, and every rule.
- `docs/DECISIONS.md` - the rulings about this component, the choices made at the build, and what the split brought here.
