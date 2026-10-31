#!/usr/bin/env node
// clean-dist - remove dist/ before a build, so a file whose source was deleted never reaches a release.
//
// Usage:  node tools/clean-dist.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
