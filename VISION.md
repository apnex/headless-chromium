# headless-chromium - Vision

**Status: drafted at the split, 2026-10-31, for `0.1.0`, under draw's ruling `H26-19` as amended again; it awaits the director's ratification, and until then binds nothing; enduring once ratified.**\
This document states why headless-chromium exists and what it will never be.\
It carries no current state, no roadmap, and no schedule.

Holding this document authorises nothing.\
A change of direction is recorded as a decision first and absorbed here afterwards.

---

**North star.**\
A test drives a real headless browser exactly as a person's input would, and the browser leaves nothing of itself behind -- no process, no folder, no line in the user's keyring or crash reports -- however the test ends.

**Why it exists.**\
Projects that test in a real browser each kept their own way to launch Chrome, speak to it, dispatch trusted input and serve it pages, and each copy carried the same traps: a lock folder Chrome renames in a later version, crash handlers that leave its group, a keyring it rewrites, a pointer it drops on a move that names no button.\
headless-chromium holds those once, so a trap found is fixed once, and takes `clean-runner` for what ends a started process and its folders.

**What it is.**\
A development dependency of a project's tests: a Chrome launcher, a DevTools session, trusted input with focus loss, and a static server, each tied to the process that started it.

**What it is not.**
- Not the runner: running tests clean, and the lifetime of processes and folders, are `clean-runner`'s.
- Not a page driver: selectors, waits and a page's own steps are the project's.
- Not every browser: headless Chromium alone.
- Not shipped: nothing of it reaches a project's users.
- Not portable beyond Linux, where the machines that run these tests are.

**What success means.**
- **Nothing left behind:** a Chrome, a session and a server end with their test, closed or not, killed or not.
- **The user's own untouched:** no browser a test starts writes to the user's keyring, crash reports or temporary folder.
- **Input as a person sends it:** a test's input reaches the page as trusted input does, the traps of Chrome's protocol handled once.
- **One duty:** it holds what driving a browser needs, and nothing a run without one needs.

**Authority.**\
Held by the director; drafted by anyone, ratified only by the director; amended, never quietly rewritten.
