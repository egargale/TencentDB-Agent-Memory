/**
 * Fork check (not upstream): every block we hand to the agent must be English,
 * and it must keep the same structure — tags, tool names, URLs, header names and
 * error codes — as the Chinese upstream rendering. Upstream adds Chinese text
 * from time to time; this is what tells you on the next `git merge`.
 *
 * Usage (tsx ships in the proxy image):
 *   docker run --rm --entrypoint node memory-proxy:en --import tsx/esm scripts/i18n-check.ts
 *   # or with deps installed: npx tsx scripts/i18n-check.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const CJK = /[\u4e00-\u9fff]/;

async function render(): Promise<Record<string, string>> {
  const { renderTdaiMemoryToolsBlock } = await import("../src/injection/injectors/tdai-tools-injector.js");
  const { MEMORY_TOOLS_GUIDE } = await import("../src/injection/injectors/tdai-profile-memory-injector.js");
  const { MEMORY_TOOLS_GUIDE_EN } = await import("../src/injection/injectors/i18n/tdai-profile-memory.en.js");
  const { renderSkillToolsBlock } = await import("../src/injection/injectors/skill-tools-injector.js");
  const { renderKnowledgeToolsBlock } = await import("../src/injection/injectors/knowledge-tools-injector.js");
  const { wrapAvailableSkillsBlock } = await import("../src/injection/injectors/skill-injector.js");
  const { renderAssetReflectionBlock } = await import("../src/injection/injectors/asset-reflection-injector.js");
  const { getHelpText } = await import("../src/mem-command/commands/help.js");
  const { isEn } = await import("../src/i18n/lang.js");

  const base = "http://127.0.0.1:8096";
  const knowledge = [
    {
      knowledge_id: "kn-1",
      type: "code-graph" as const,
      service_url: "http://core.example/v3/knowledge",
      name: "demo-repo",
      summary: "42 files, 300 symbols",
      team_id: "t-1",
      user_id: null,
      repo_url: "https://github.com/example/demo-repo",
      branch: "main",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
  ];

  return {
    "tdai-memory-tools": renderTdaiMemoryToolsBlock(base, "sid-1", "space-1"),
    "memory-tools-guide": isEn ? MEMORY_TOOLS_GUIDE_EN : MEMORY_TOOLS_GUIDE,
    "skill-tools": renderSkillToolsBlock(base, true, "sid-1", "space-1"),
    // urlsById must be populated, otherwise the instantiations list is empty in
    // BOTH locales and the token diff below cannot catch a broken join.
    "knowledge-tools": renderKnowledgeToolsBlock(
      knowledge, "space-1", { sessionKey: "sid-1" },
      new Map(knowledge.map((k) => [k.knowledge_id, k.service_url])),
    ) ?? "",
    "available-skills": wrapAvailableSkillsBlock("LISTING"),
    "asset-reflection": renderAssetReflectionBlock(["skill_tools", "tdai_memory_tools"]),
    "mem-help": getHelpText(),
  };
}

/** Structural tokens that must survive translation (whitelist only — prose
 * contains `<>` and snake_case too, so a generic regex is useless here). */function tokens(text: string): string[] {
  const out = new Set<string>();
  const add = (re: RegExp, fmt?: (m: RegExpMatchArray) => string) => {
    for (const m of text.matchAll(re)) out.add(fmt ? fmt(m) : m[1] ?? m[0]);
  };
  add(
    /<(\/?)(tdai_memory_tools|tdai_profile_memory|memory-tools-guide|skill_tools|available_skills|knowledge_tools|asset_reflection|l2_scene_index|l3_core_memory|agent)\b/g,
    (m) => `${m[1]}${m[2]}`,
  );
  add(/name="([a-z_]+)"/g);
  add(/(x-[a-z-]+)/g);
  // Endpoint instantiations (`## Actual endpoint per resource` / `## 各资源实际地址`):
  // the heading is translated, so a mismatch would silently ship one locale's
  // heading to the other. Keep the rendering exercised — see `knowledge` below.
  add(/(tools\/list|tools\/call)/g);
  add(/((?:memory|skill)-bridge[^\s'"`\\]*)/g);
  add(/\bpath: (\S+)/g);
  add(/\b([45]\d{4})\b/g);
  return [...out].sort();
}

/**
 * Files whose Chinese is reachable by a Claude Code session. Every CJK literal
 * here must sit inside `t(zh, en)`; an unwrapped one is a string the agent will
 * see in Chinese (this is what the static scan catches).
 *
 * Not listed on purpose: the zh renderers in `injection/injectors/*.ts` (guarded
 * by an `isEn` early-return and checked dynamically below), `commands/help.ts`
 * (single HELP_TEXT const, checked through getHelpText), and the other clients'
 * form builders, which this fork does not translate.
 */
const STATIC_TARGETS = [
  "src/pipeline/stages/mem-command-intercept.ts",
  "src/pipeline/stages/session-init-orchestrate.ts",
  "src/pipeline/runners/anthropic.ts",
  "src/mem-command/index.ts",
  "src/mem-command/parser.ts",
  "src/mem-command/pre-intercept.ts",
  "src/mem-command/task-draft-generator.ts",
  "src/mem-command/commands/config-lock.ts",
  "src/mem-command/commands/config-unlock.ts",
  "src/mem-command/commands/create-skill.ts",
  "src/mem-command/commands/create-task.ts",
  "src/mem-command/commands/session-reset.ts",
  "src/mem-command/commands/sync.ts",
  "src/mem-command/commands/update-task.ts",
  "src/session/store.ts",
  "src/session/user-default.ts",
  "src/session/claude-code/form.ts",
  "src/session/claude-code/init.ts",
  "src/session/claude-code/extractor.ts",
  "src/session/claude-code/cleaner.ts",
  "src/session/claude-code/pagination.ts",
];

/**
 * Scan JS/TS source for string literals that contain CJK and are NOT inside a
 * `t(...)` call. Tracked: string literals, template literals with `${}`
 * interpolation, regex literals, and paren depth (so `t(\`...${a ?? "x"}\`)`
 * counts as covered while a sibling literal does not).
 */
function scanCjkLiterals(src: string): Array<{ line: number; text: string }> {
  const bad: Array<{ line: number; text: string }> = [];
  const openT: number[] = []; // paren depth at which each `t(` was opened
  let depth = 0;
  let i = 0;
  const n = src.length;
  const lineOf = (at: number) => src.slice(0, at).split("\n").length;

  const prevMeaningful = (at: number): string => {
    let j = at - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    return j >= 0 ? src[j] : "";
  };

  while (i < n) {
    const c = src[i];
    // regex literal
    if (c === "/" && src[i + 1] !== "/" && src[i + 1] !== "*" && /[(,=:[!&|?{};+\-*/%~^]|^$/.test(prevMeaningful(i))) {
      i++;
      let inClass = false;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) { i++; break; }
        else if (src[i] === "\n") break;
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const at = i;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (quote !== "`" && src[i] === "\n") break; // unterminated
        if (src[i] === quote) { i++; break; }
        i++;
      }
      const text = src.slice(at, i);
      if (CJK.test(text) && openT.length === 0 && !cjkOnlyInsideTranslatedInterpolation(text)) {
        bad.push({ line: lineOf(at), text: text.replace(/\s+/g, " ").slice(1, 71) });
      }
      continue;
    }
    if (c === "(") {
      depth++;
      // `t(` — identifier check on the previous non-space char run
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      if (j >= 0 && src[j] === "t" && !/[\w$.]/.test(src[j - 1] ?? "")) openT.push(depth);
      i++;
      continue;
    }
    if (c === ")") {
      if (openT.length > 0 && openT[openT.length - 1] === depth) openT.pop();
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return bad;
}

/**
 * Template literals can carry the Chinese only inside an interpolation that is
 * itself translated, e.g. `` `- Task: ${cond ? t("中文", "en") : x}` `` — the
 * literal's own text is ASCII, so it is not a leak. True when every CJK char of
 * `text` sits inside a `${...}` region that contains a `t(` call.
 */
function cjkOnlyInsideTranslatedInterpolation(text: string): boolean {
  if (!text.includes("${")) return false;
  const translated: Array<[number, number]> = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== "$" || text[i + 1] !== "{") continue;
    let depth = 1;
    let j = i + 2;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
    }
    const region = text.slice(i, j);
    if (/\bt\(/.test(region)) translated.push([i, j]);
  }
  if (translated.length === 0) return false;
  for (let k = 0; k < text.length; k++) {
    if (!CJK.test(text[k])) continue;
    if (!translated.some(([a, b]) => k >= a && k < b)) return false;
  }
  return true;
}

/** Every CJK literal in STATIC_TARGETS must be inside a `t(...)` call. */
function staticScan(): boolean {
  let failed = false;
  for (const rel of STATIC_TARGETS) {
    const path = fileURLToPath(new URL(`../${rel}`, import.meta.url));
    const src = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/^\s*\/\/.*$/gm, (m) => " ".repeat(m.length));
    for (const hit of scanCjkLiterals(src)) {
      console.error(`✗ ${rel}:${hit.line}: Chinese literal outside t(): ${hit.text}`);
      failed = true;
    }
  }
  return failed;
}

if (!process.argv.includes("--child")) {
  const failedStatic = staticScan();
  const run = (lang: string) => {
    const res = spawnSync(process.execPath, ["--import", "tsx/esm", SELF, "--child"], {
      env: { ...process.env, PROXY_LANG: lang },
      encoding: "utf8",
    });
    if (res.status !== 0) {
      console.error(res.stderr || res.stdout);
      throw new Error(`child (PROXY_LANG=${lang}) exited ${res.status}`);
    }
    return JSON.parse(res.stdout) as Record<string, string>;
  };

  const zh = run("zh");
  const en = run("en");
  let failed = failedStatic;

  for (const name of Object.keys(en)) {
    const hit = CJK.exec(en[name]);
    if (hit) {
      const at = en[name].slice(Math.max(0, hit.index - 40), hit.index + 40);
      console.error(`✗ ${name}: Chinese text leaked into the English block → …${at}…`);
      failed = true;
    }
    const zhTokens = tokens(zh[name]);
    const enTokens = tokens(en[name]);
    const missing = zhTokens.filter((t) => !enTokens.includes(t));
    const extra = enTokens.filter((t) => !zhTokens.includes(t));
    if (missing.length || extra.length) {
      console.error(`✗ ${name}: structure drift vs the zh rendering`);
      if (missing.length) console.error(`   missing in en: ${missing.join(" ")}`);
      if (extra.length) console.error(`   extra in en:   ${extra.join(" ")}`);
      failed = true;
    }
  }

  if (failed) {
    console.error("\ni18n check FAILED — translate the new upstream text in the matching *.en.ts file.");
    process.exit(1);
  }
  console.log(`✓ i18n check passed (${Object.keys(en).length} blocks; en matches zh structure, no Chinese left)`);
} else {
  process.stdout.write(JSON.stringify(await render()));
}
