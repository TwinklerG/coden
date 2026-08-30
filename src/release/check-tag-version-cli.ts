import { readFileSync } from "node:fs";
import { versionMismatch } from "./check-tag-version.js";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: check-tag-version <vX.Y.Z>");
  process.exit(2);
}
const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };
const error = versionMismatch(tag, pkg.version);
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(`tag ${tag} matches package.json version ${pkg.version}`);
