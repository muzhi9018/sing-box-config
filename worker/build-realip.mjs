import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { platforms, renderTemplate } from "./render.mjs";

const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === "--check";
if (args.length && !check) {
  console.error("Usage: node build-realip.mjs [--check]");
  process.exit(1);
}

const outputDirectory = new URL("./generated/", import.meta.url);
const common = readTemplate("common.json");
const templates = platforms.map(platform => ({
  path: new URL(`template-realip-${platform}.json`, outputDirectory),
  content: renderTemplate(common, readTemplate(`platforms/${platform}.json`)),
}));

if (!check) {
  mkdirSync(outputDirectory, { recursive: true });
}

function readTemplate(path) {
  return JSON.parse(readFileSync(new URL(`./templates/${path}`, import.meta.url), "utf8"));
}

for (const { path, content } of templates) {
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) {
      console.error(`Regenerate ${path.pathname.split("/").at(-1)} with node build-realip.mjs from worker/`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(path, content);
  }
}
