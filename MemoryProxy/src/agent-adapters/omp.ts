/**
 * omp (oh-my-pi) client adapter.
 *
 * omp is a Pi fork: same OpenAI Chat Completions wire format. User content is
 * either a plain string or an array of text parts (system-reminder blocks
 * first), so harness wrappers go through the shared user-query extractor.
 * No cache_control markers / fork-sidequery concept.
 */
import { extractUserQueryText } from "../common/user-query-extractor.js";
import { defaultAdapter } from "./default.js";
import type { AgentAdapter } from "./types.js";

/** omp's title generator caps the provider call at 1024 tokens (omp 18.22.0). */
const OMP_TITLE_MAX_TOKENS = 1024;

/**
 * omp's title generator calls the same `tdai` provider with a single user
 * message, no tools and a 1024-token cap. Treat it as auxiliary so it gets no
 * memory injection and writes no L0 turn.
 */
function isOmpAuxRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  if ("tools" in body && Array.isArray(body.tools) && body.tools.length > 0) return false;
  if (!("max_tokens" in body) || body.max_tokens !== OMP_TITLE_MAX_TOKENS) return false;
  if (!("messages" in body) || !Array.isArray(body.messages) || body.messages.length !== 1) return false;
  const msg: unknown = body.messages[0];
  return !!msg && typeof msg === "object" && "role" in msg && msg.role === "user";
}

export const ompAdapter: AgentAdapter = {
  agentKind: "omp",
  classifyRequest(body) {
    return isOmpAuxRequest(body) ? "auxiliary" : "main";
  },
  extractUserText(content) {
    const raw = typeof content === "string" ? content : defaultAdapter.extractUserText(content);
    if (!raw) return null;
    const extracted = extractUserQueryText(raw);
    return extracted.length > 0 ? extracted : null;
  },
};
