// workflows - the gate and the release (CONTRACT.md Reference): the gate runs npm run gate on Node 22 and 24 and then
// the consumer test; a release packs once, tests the packed file, retries the draft's lookup, and compares what it
// downloads with what it packed before it publishes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ROOT } from "../support/helpers.js";

test("the workflows: the gate runs npm run gate on Node 22 and 24 and then the consumer test; a release packs once, retries the draft's lookup and compares what it downloads before it publishes", () => {
	const gate = fs.readFileSync(path.join(ROOT, ".github", "workflows", "gate.yml"), "utf8");
	assert.match(gate, /^ {8}node: \['22', '24'\]$/m);
	assert.match(gate, /^ {6}- run: npm run gate$/m);
	assert.match(gate, /^ {6}- run: npm run consumer$/m);
	const release = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");
	assert.match(release, /echo "FILE=apnex-headless-chromium-\$version\.tgz"/);
	assert.match(release, /for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do/, "the draft's lookup is retried twelve times");
	assert.match(release, /^ {12}sleep 5$/m, "five seconds apart");
	assert.match(release, /cmp "\$RUNNER_TEMP\/packed\/\$FILE" "\$RUNNER_TEMP\/downloaded\/\$FILE"/);
	assert.ok(release.indexOf("npm run consumer -- --tarball") < release.indexOf("gh release create"), "the consumer test runs on the packed file before the draft is made");
	assert.ok(release.indexOf("cmp ") < release.indexOf("-F draft=false"), "and the download is compared before the draft is published");
	assert.match(release, /\*\) echo "version \$version is outside 0\.x/);
});
