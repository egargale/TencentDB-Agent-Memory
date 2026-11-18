/**
 * Session key resolution & conversation freshness check.
 *
 * Shared between handler.ts and anthropicHandler.ts.
 */
import type { Context } from "hono";

/**
 * Extract conversation ID from request headers. Returns null if no valid ID found.
 *
 * ── subagent 会话归一（2026-09-20，修复 WorkBuddy 压缩后无限弹表单循环）──
 * WorkBuddy 助理派生并行 subagent 时，每个 subagent 用**独立的新 x-conversation-id**，
 * 但会带 `x-parent-conversation-id` 指向父（主）会话。若按 subagent 自己的
 * conversation-id 做 session key，会在 session store 里查不到主会话已完成的
 * session-init（initialized 绑定），于是每个 subagent 都被判为"新会话"→ 重弹
 * 「选择 Agent/Task」表单；表单又被 replay 进历史 → 无限循环。
 *
 * 修法：**subagent 请求（带 x-parent-conversation-id）一律用 parent id 作为
 * 会话身份** —— 让 subagent 复用主会话的 session key，天然继承 agent/task/team
 * 绑定，不再触发 session-init。主会话请求无此 header，行为完全不变（零侵入）。
 *
 * 实测证据（opik 2026-09-14 + 本地抓包 2026-09-20）：
 *   主会话   : x-conversation-id=888a1848..  x-parent-conversation-id=(无)  purpose=conversation type=main
 *   subagent : x-conversation-id=01a0bcff..  x-parent-conversation-id=888a1848.. purpose=subagent:general-purpose type=team
 *   → subagent.parent === 主会话.conv，故用 parent 归一到主会话身份。
 */
export function resolveConversationId(c: Context): string | null {
  // subagent 优先用 parent-conversation-id 归一到父（主）会话身份。
  const parentId = c.req.header("x-parent-conversation-id");
  if (parentId && parentId.length > 0) return parentId;

  const id =
    c.req.header("x-conversation-id") ??
    c.req.header("x-session-id") ??
    c.req.header("x-claude-code-session-id") ?? // Claude Code CLI sends this
    c.req.header("x-deepseek-harness-session-id") ?? // dsh (deepseek-harness) CLI/web sends this
    c.req.header("x-chat-id") ??
    c.req.header("x-thread-id") ??
    null;
  return id && id.length > 0 ? id : null;
}

/**
 * Header-less clients (omp) mark their conversation in the body: the omp
 * extension cannot set per-request headers, so it prepends
 * `[tdai-conversation-id:<id>]\n` to the first user message. Only consulted as
 * a fallback — a real header always wins.
 *
 * The marker must be the leading line of the message / first text part. An
 * unanchored match would let text pasted from a log or README become the
 * session key.
 */
const BODY_CONVERSATION_MARKER_RE = /^\[tdai-conversation-id:([^\]\s]{1,128})\]\n?/;
/** Any leading marker line, for scrubbing (id charset not validated). */
const BODY_CONVERSATION_MARKER_LINE_RE = /^\[tdai-conversation-id:[^\]\n]*\]\n?/;

export function resolveConversationIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("messages" in body)) return null;
  if (!Array.isArray(body.messages)) return null;
  const messages: unknown[] = body.messages;
  for (const m of messages) {
    if (!m || typeof m !== "object" || !("role" in m) || m.role !== "user") continue;
    if (!("content" in m)) return null;
    const content = m.content;
    if (typeof content === "string") {
      const hit = BODY_CONVERSATION_MARKER_RE.exec(content);
      if (hit) return hit[1];
    } else if (Array.isArray(content)) {
      const parts: unknown[] = content;
      for (const part of parts) {
        if (!part || typeof part !== "object" || !("text" in part) || typeof part.text !== "string") continue;
        const hit = BODY_CONVERSATION_MARKER_RE.exec(part.text);
        if (hit) return hit[1];
        break; // only the first text part can carry the marker
      }
    }
    return null; // only the first user message can carry the marker
  }
  return null;
}

/**
 * Remove the leading `[tdai-conversation-id:…]` line from the first user
 * message. Mutates the message in place so everything downstream — mem-command
 * detection, L0 capture, the upstream prompt — sees clean user text.
 */
export function stripBodyConversationMarker(body: unknown): void {
  if (!body || typeof body !== "object" || !("messages" in body)) return;
  if (!Array.isArray(body.messages)) return;
  const messages: unknown[] = body.messages;
  for (const m of messages) {
    if (!m || typeof m !== "object" || !("role" in m) || m.role !== "user" || !("content" in m)) continue;
    const content = m.content;
    if (typeof content === "string") {
      m.content = content.replace(BODY_CONVERSATION_MARKER_LINE_RE, "");
    } else if (Array.isArray(content)) {
      const parts: unknown[] = content;
      for (const part of parts) {
        if (!part || typeof part !== "object" || !("text" in part) || typeof part.text !== "string") continue;
        part.text = part.text.replace(BODY_CONVERSATION_MARKER_LINE_RE, "");
        break; // the marker rides on the first text part only
      }
    }
    return;
  }
}

/** Check whether the messages look like a fresh conversation (at most 1 user message, no assistant/tool). */
export function isFreshConversation(
  messages: Array<{ role?: string }>,
): boolean {
  let userCount = 0;
  for (const m of messages) {
    const role = m.role ?? "";
    if (role === "assistant" || role === "tool") return false;
    if (role === "user") userCount++;
    if (userCount > 1) return false;
  }
  return userCount <= 1;
}
