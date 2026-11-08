#!/usr/bin/env node
// gen-data.mjs — ساخت دادهٔ سایت از یک checkout از ریپوی ECC
// استفاده: node site/tools/gen-data.mjs --src /path/to/ecc [--out site/assets/data.js]
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const SRC = resolve(arg("src", join(here, "..", "..", "..", "ecc")));
const OUT = resolve(arg("out", join(here, "..", "assets", "data.js")));

if (!existsSync(join(SRC, "skills"))) {
  console.error(`[gen-data] skills/ پیدا نشد در: ${SRC}\n  از --src /path/to/ecc استفاده کنید.`);
  process.exit(1);
}

function frontmatterDesc(file) {
  let text = "";
  try {
    text = readFileSync(file, "utf8").slice(0, 4000);
  } catch {
    return "";
  }
  const m = text.match(/^description:\s*([\s\S]*?)$/m);
  if (!m) return "";
  let d = m[1].trim();
  if (d.startsWith('"') || d.startsWith("'")) {
    const q = d[0];
    const end = d.indexOf(q, 1);
    d = end > 0 ? d.slice(1, end) : d.slice(1);
  }
  d = d.replace(/\s+/g, " ").trim();
  if (d.length > 240) d = d.slice(0, 237).replace(/[ ,;:]$/, "") + "…";
  return d;
}

const readDir = (dir) => (existsSync(join(SRC, dir)) ? readdirSync(join(SRC, dir)) : []);

const skills = readDir("skills")
  .filter((n) => {
    const p = join(SRC, "skills", n);
    return statSync(p).isDirectory() && existsSync(join(p, "SKILL.md"));
  })
  .map((n) => ({ name: n, desc: frontmatterDesc(join(SRC, "skills", n, "SKILL.md")) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const commands = readDir("commands")
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ name: f.replace(/\.md$/, ""), desc: frontmatterDesc(join(SRC, "commands", f)) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const agents = readDir("agents")
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ name: f.replace(/\.md$/, ""), desc: frontmatterDesc(join(SRC, "agents", f)) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const version = existsSync(join(SRC, "VERSION")) ? readFileSync(join(SRC, "VERSION"), "utf8").trim() : "unknown";

const payload = {
  source: "https://github.com/affaan-m/ecc",
  license: "MIT © Affaan Mustafa",
  version,
  generatedAt: new Date().toISOString().slice(0, 10),
  counts: { skills: skills.length, commands: commands.length, agents: agents.length },
  skills,
  commands,
  agents,
};

writeFileSync(
  OUT,
  "/* ساخته‌شده با site/tools/gen-data.mjs — از ریپوی affaan-m/ecc (MIT). دستی ویرایش نکنید. */\n" +
    "window.ECC_DATA = " +
    JSON.stringify(payload, null, 0) +
    ";\n"
);
console.log(`[gen-data] ${payload.counts.skills} skills, ${payload.counts.commands} commands, ${payload.counts.agents} agents → ${OUT}`);
