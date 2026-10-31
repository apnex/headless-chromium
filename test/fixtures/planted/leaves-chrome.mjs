// A planted test file (test/contract/chrome-launch.test.js): it launches Chrome and ends without closing it -- a Chrome
// never holds its starter open, so the file ends, and Chrome runs on until its tether stops it.
import { launchChrome } from "@apnex/headless-chromium";

const chrome = await launchChrome();
process.stdout.write(`planted chrome ${chrome.pid} ${chrome.folder}\n`);
