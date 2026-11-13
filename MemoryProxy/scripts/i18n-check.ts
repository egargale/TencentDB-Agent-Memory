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
    "knowledge-tools": renderKnowledgeToolsBlock(knowledge, "space-1", { sessionKey: "sid-1" }) ?? "",
    "available-skills": wrapAvailableSkillsBlock("LISTING"),
    "asset-reflection": renderAssetReflectionBlock(["skill_tools", "tdai_memory_tools"]),
    "mem-help": getHelpText(),
  };
}

/** Structural tokens that must survive translation (whitelist only — prose
 * contains `<>` and snake_case too, so a generic regex is useless here). */
function tokens(text: string): string[] {
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
  add(/((?:memory|skill)-bridge[^\s'"`\\]*)/g);
  add(/\bpath: (\S+)/g);
  add(/\b([45]\d{4})\b/g);
  return [...out].sort();
}

if (!process.argv.includes("--child")) {
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
  let failed = false;

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
