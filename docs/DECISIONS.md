# Decisions

One ruling per entry, append-only.\
A ruling is never edited; a later one supersedes it and says so.

Rulings that shape this component together with its consumers are held in draw's `dev/DECISIONS.md` (`apnex/drawv2`), and cited here as "draw's `Hn-m`".

---

## D1 - The component stands in its own public repository

**Ruled by:** the director, 2026-10-31 (draw's `H26-19`, amended again: the split).\
**Affects:** this repository, its package and its releases.

**Ruling.**\
headless-chromium is a component of its own, in the public repository `apnex/headless-chromium`, its package `@apnex/headless-chromium`, its first release `0.1.0` and its one export path `.`, released from its own CI as a tarball attached to a GitHub release, and taken by a project in its tests alone, as a development dependency pinned to its release file.\
It depends on `clean-runner` `0.2.0` for a started process's lifetime and its folders: a runtime dependency, pinned to `clean-runner`'s release file by its URL and its hash.\
Its versions are `0.x` until mission-kit admits it to the component registry.

**Why.**\
Driving headless Chromium for a test is a duty of its own, needed only by projects whose tests use a browser; what makes a run leave nothing is another, needed by every project, and stands in `clean-runner`.

---

## D2 - The contract of record is CONTRACT.md

**Ruled by:** the director, 2026-10-31 (draw's `H26-19` as amended, which rules that no test run may leave anything behind, and amended again, which splits the shared component by its two duties).\
**Affects:** `CONTRACT.md`, `VISION.md`, `src/`, `test/`, `tools/` and `.github/workflows/`.

**Ruling.**\
The contract of record is this repository's `CONTRACT.md`, its rules HC1 to HC5 and its invariants I1 to I10; `VISION.md` was drafted with it and awaits the director's ratification.\
The structure, the `tsconfig.json`, the checks, the workflows and the documents follow `vector-scene`'s, as `clean-runner`'s do.

**Choices made at build.**\
Each that a test can hold is held by one:
- Each Chrome's launch folder is its `TMPDIR` and holds its profile unless the caller names one, so one removal takes the lock folder in either spelling, the further folders of the same name Chrome makes and never removes, and the profile; close stops the group, then every process naming the launch folder -- the crash handlers, which leave the group and keep the environment they were started with -- then removes it.
- Chrome writes its process titles over its own environment, so the processes of its group no longer name the launch folder there (measured on Chrome 136); they are found by the profile their command lines name, and by group.
- The shared flags are the copies' union: draw's four, the components' `--no-first-run` and `--no-default-browser-check`, and `input-tester`'s four that keep Chrome's own requests off the network; a window size and a start option stay each project's own `args`.
- And one no copy had, `--password-store=basic`: found while checking, before the report, that nothing outside the role folder had changed, every Chrome launched without it rewrote the user's login keyring, `~/.local/share/keyrings/login.keyring` (measured, Chrome 136: with the flag the keyring is untouched). Every copy in the six projects launched Chrome without it.
- `dumpDom` writes Chrome's standard output to a file in its launch folder rather than reading it from a stream, so no stream of this component's own can hold Chrome open.

- Chrome's configuration home, `XDG_CONFIG_HOME`, is `<launch folder>/config`: its crash reporter keeps its settings and its reports under the configuration home, not the profile -- every launch rewrote the user's `Crash Reports/settings.dat`, and every crash added a report there (measured, Chrome 136) -- so they land in the launch folder and go with it.
- The launch folder is a `clean-runner` scratch folder and Chrome its tethered process, reached through `clean-runner`'s public exports alone: `scratchFolder` makes the folder, handed to the warden before it is made; `spawnTethered` starts Chrome; `stopGroup` stops its group; and `removeScratchFolder` stops what still names the folder, removes it and takes it back from the warden. The runtime check allows `@apnex/clean-runner` by its bare name and refuses any path into it, so the component can reach nothing of `clean-runner`'s insides.
- The runner is given no `--test-force-exit`, in this repository's own `test` script and in the README: on Node.js 22 the flag dropped results a test file reported while the run passed.

---

## D3 - The split: what came here, and from where

**Ruled by:** the director, 2026-10-31 (draw's `H26-19`, amended again: "continue as recommended. No legacy retained").\
**Affects:** every file of this repository.

**Ruling.**\
The shared component held two duties, and the second, driving headless Chromium for a test, is this repository: the Chrome launcher (`findChrome`, `launchChrome`, `dumpDom`), the DevTools session (`connectToPage`), trusted input (`BUTTON_BITS`, `BUTTON_NAMES`, `heldButtonName`, `mouseEventParams`, `loseFocus`) and the static server (`serveStatic`), with their tests and the fake Chrome.\
The code came from `apnex/test-harness`, the repository now named `apnex/clean-runner`, whose history up to the split is its provenance; nothing of that name is kept here as a re-export, an alias or a path.

**What changed in what came.**
- The launcher reaches `clean-runner` through its public exports alone, where it reached the shared component's insides: its launch folder a scratch folder, removed by `removeScratchFolder`.
- What the runner knew of Chrome comes here, as Chrome's: `lockSocketWarning`, the warning the runner gave when a temporary folder is too long for Chrome's lock socket, and `isLockFolderName`, the lock folder known in either spelling, which the runner used to note on a leftover. The launcher refuses a temporary folder too long with the warning's words.
- A test that ends with its Chrome running is held here, under `clean-runner`'s runner, which names the Chrome.
- The runtime check allows the one runtime dependency by its bare name, and the source check its declaration files.

**The rule ids.**\
Each rule is renumbered for this duty alone; `clean-runner` numbers its own.

| Old | Now |
|---|---|
| TH1, the run | `clean-runner` |
| TH2, the tether and the warden | `clean-runner` |
| TH3, the Chrome launch | HC1, with `lockSocketWarning` and `isLockFolderName` |
| TH4, the DevTools session | HC2 |
| TH5, trusted input | HC3 |
| TH6, scratch folders | `clean-runner` |
| TH7, the static server | HC4 |
| TH8, exports and platform | HC5, with the dependency on `clean-runner` |
| I6, I7, I8, I10, I11, I12, I13, I14 | I1, I2, I3, I4, I5, I6, I7, I8 |
| I5's Chrome, and I15's closed Chrome's path | I9 |
| I1's and I3's Chrome -- a Chrome left running, lock folders, a temporary folder too long | I10 |
| I1 to I4, I9 and the rest of I5 and I15 | `clean-runner` |

**What the adopters found, and which of it is here.**\
Of the five candidates found switching the six projects onto the shared component (draw's `B438`), two are this component's, and held:
- The static server takes no fixed port, so a project serving its site at a fixed port relays that port to it.
- The window size is an argument each adopter must remember.

The README's `--test-force-exit` advice is gone here as in `clean-runner`; the other two candidates are `clean-runner`'s.

**Why.**\
A third of what was shared is the Chrome family's alone, and a project whose tests drive no browser should not take a browser driver to run clean.

---

## D4 - A launch folder's removal is tried again until the folder is gone

**Ruled by:** the director, 2026-10-31 (the release run of `v0.1.0`, which made no release).\
**Affects:** `src/chrome-launch.ts`, `test/contract/chrome-launch.test.js`, `test/fixtures/fake-chrome.mjs` and `CONTRACT.md` (HC1 rules 5 and 6, `dumpDom`, I9).

**Ruling.**\
The release run on the tag `v0.1.0` failed one test on GitHub's runner, the launch of a Chrome that exits before writing its port, or never writes one: a launch folder, `ch-XXXXXX`, was left when the launch was refused.\
The launcher removed each launch folder once, with clean-runner's `removeScratchFolder`, and set aside its answer; a removal that answered `false` left the folder to the warden, removed only when the starter ended.\
Now every removal of a launch folder -- `close()`, a refused launch, `dumpDom` and a launch whose tether could not start -- calls `removeScratchFolder` again, which stops what names the folder again and removes it, until it answers `true` or 15 seconds have passed, when the warden still holds the folder; the call answers only then.

**Why a removal fails.**\
A process no stop reaches can still be writing into the folder: a crash handler, which leaves Chrome's group, and whose title Chrome rewrites so that it names the folder followed by a space, which `processesNaming` does not count as a path's end.\
Measured: clean-runner's removal, `rmSync` with ten retries, sweeps the folder's entries once and then retries only the folder itself, so a writer active during that one sweep -- for 300 ms, for one second or for three -- made it fail with `ENOTEMPTY` every time, after 5.5 seconds; one removal after the writer had stopped succeeded.

**How it is held.**\
The fake Chrome, given `FAKE_CHROME_LATE`, leaves such a writer as it ends: detached into a session of its own, its environment and working folder naming nothing of the launch folder, its title naming it only followed by a space, filling the folder for 1.5 seconds and ending only once it has begun.\
Before the change, its test failed: the refused launch of a Chrome that exits left its launch folder; a probe of the four paths over the same build found each leaving its folder, answering after 5.7 to 6.1 seconds.\
After it, the test passes, and the probe found each folder gone when the call answered, after 6.6 to 7.0 seconds: the first removal failing on the writer, the second succeeding.

**For clean-runner's next release (draw's `B438`).**\
`removeScratchFolder` should itself try again within a bound, stopping what names the folder and sweeping its entries anew on each try, since its removal's retries sweep only once; and `processesNaming` should count a space as a path's end, the candidate already held there, so a process whose title Chrome rewrote is found and stopped.\
Until then this component holds the retry, through clean-runner's public surface alone.

---

## D5 - The vision is ratified as written

**Ruled by:** the director, 2026-11-01.\
**Affects:** `VISION.md`.

**Ruling.**\
`VISION.md`, drafted at the split for the first release, is ratified as written: its north star, why it exists, what it is and is not, what success means, and its authority.\
It is enduring from today; a change of direction is recorded here as a decision first and absorbed into it afterwards.

**Why.**\
Until ratified it bound nothing, so nothing held the component to its one duty; it states what the component already does, and what draw's `H26-19`, amended again, split it out to be.
