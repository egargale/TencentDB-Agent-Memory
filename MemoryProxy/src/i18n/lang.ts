/**
 * Fork-only language switch. Everything user-facing (injected prompt blocks,
 * the session-init form, `mem:` command output) goes through here.
 *
 *   PROXY_LANG=en (default) — English strings
 *   PROXY_LANG=zh           — upstream Chinese strings, byte-identical
 *
 * Upstream code never imports this: the fork adds one early-return per renderer
 * plus `t()` around inline literals, so `git merge origin/feat/server_team`
 * stays conflict-free unless upstream edits those exact lines.
 */
export const LANG: "en" | "zh" = process.env.PROXY_LANG === "zh" ? "zh" : "en";

export const isEn = LANG === "en";

/** Pick the locale variant of an inline literal. */
export function t<T>(zh: T, en: T): T {
  return isEn ? en : zh;
}
