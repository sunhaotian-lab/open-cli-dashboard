import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DOCS_DIR = path.join(ROOT_DIR, "docs");

async function main() {
  execFileSync(process.execPath, [path.join(__dirname, "build-static.mjs")], {
    cwd: ROOT_DIR,
    stdio: "inherit"
  });

  await fs.rm(DOCS_DIR, { recursive: true, force: true });
  await fs.cp(PUBLIC_DIR, DOCS_DIR, { recursive: true });
  console.log(`Copied static site to ${DOCS_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
