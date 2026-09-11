import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["src", "tests", "scripts"];
const failures = [];

async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if ([".ts", ".mjs"].includes(extname(file))) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        const content = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (content.includes("\t")) failures.push(`${file}:${index + 1}: tab character`);
        if (/[ \t]+$/.test(content)) failures.push(`${file}:${index + 1}: trailing whitespace`);
      });
    }
  }
}

for (const root of roots) await visit(root);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Lint passed.");
}

