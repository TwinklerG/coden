import process from "node:process";
import { syncDocFiles } from "../src/lib/docs-files";

const mode = process.argv.includes("--check") ? "check" : "write";
const result = await syncDocFiles(process.cwd(), mode);

if (result.issues.length > 0) {
  for (const issue of result.issues) console.error(issue);
  process.exitCode = 1;
} else if (mode === "check") {
  console.log(`checked ${result.expectedCount} documentation files`);
} else {
  console.log(`created ${result.created.length} missing documentation files`);
}
