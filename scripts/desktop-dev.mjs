#!/usr/bin/env node
// Builds the core daemon, then launches the Electron/React desktop app in dev mode. Kept as a small
// script (rather than a shell one-liner in package.json) so it works the same under npm and pnpm on
// Windows and POSIX shells (RULES.md prefers deterministic software over ad hoc shell glue).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopDir = join(root, "desktop");

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, VIRAL_ROOT: root } });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`))));
    child.on("error", reject);
  });
}

async function main() {
  await run("pnpm", ["run", "build"], root);
  if (!existsSync(join(desktopDir, "node_modules"))) {
    throw new Error('desktop/node_modules is missing. Run "npm install" inside desktop/ once before "desktop:dev".');
  }
  await run("npm", ["run", "dev"], desktopDir);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
