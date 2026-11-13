/**
 * English rendering of `<tdai_memory_tools>` (fork). Structure, tags, tool
 * names, URLs and header names MUST match the Chinese renderer in
 * `../tdai-tools-injector.ts` — `scripts/i18n-parity.ts` asserts it.
 */

export function renderTdaiMemoryToolsBlockEn(
  proxyBaseUrl: string,
  sessionId?: string,
  spaceId?: string,
): string {
  const base = proxyBaseUrl.replace(/\/$/, "");
  const bridge = `${base}/memory-bridge/v3`;
  const sessionHeader = sessionId ? ` -H 'x-conversation-id: ${sessionId}'` : "";
  const tenantHeader = spaceId ? ` -H 'x-tdai-service-id: ${spaceId}'` : "";
  const authHeader = `${tenantHeader}${sessionHeader}`;

  const lines: string[] = [
    "<tdai_memory_tools>",
    "**These are memory capabilities you can call** (not documentation), used through Bash + curl.",
    "This TDAI memory capability ranks equal to Claude Code's native Memory / MEMORY.md; when memory is involved, do not consult only the local MEMORY.md.",
    "When the user asks about identity, history, preferences, past conclusions or project conventions, you MUST query the TDAI memory tools below first and answer from the results.",
    "Never say \"I don't have that tool / I need an MCP / I can only search local memory\" — you do have TDAI memory tools; use the curl commands below.",
    "",
    "How to call: run curl from Bash against the proxy's memory-bridge paths. The proxy injects identity (team_id/user_id/agent_id) automatically, so the body only carries business fields. If the current agent has several bound chat_memory assets, search endpoints query self + imported memories and return source_agent_id/source_agent_name/source_agent_role on each hit.",
    "",
    "Coverage:",
    "- L3 (persona / long-term profile) and the L2 scene index (`<l2_scene_index>`) are already injected into the system prompt — no query needed;",
    "- L2 bodies are read on demand with tdai_read_scene;",
    "- L0/L1 (raw conversations / atomic memories) are NOT auto-recalled every turn (that would break the KV cache) — retrieve them with these tools when needed.",
    "",
    "  <tool name=\"tdai_memory_search\">",
    `    curl: ${bridge}/atomic/search`,
    `    body: {"query": "<text>", "limit": 5}`,
    "    use:  search L1 atomic memories (two-way hybrid: dense vector + BM25), ranked by relevance. By default searches the current agent's self + imported memories; source_agent_* on each hit shows the origin. Good for recalling user preferences, past conclusions, rules.",
    "    returns: {code, data: {items: [...], searched_agents: [...]}} — hits are in data.items[].",
    "  </tool>",
    "",
    "  <tool name=\"tdai_atomic_query\">",
    `    curl: ${bridge}/atomic/query`,
    `    body: {"type": "?episodic|persona|instruction", "limit": 20, "offset": 0, "time_start": "?ISO", "time_end": "?ISO"}`,
    "    use:  list L1 memories by type / time window / pagination (no semantic search).",
    "  </tool>",
    "",
    "  <tool name=\"tdai_conversation_search\">",
    `    curl: ${bridge}/conversation/search`,
    `    body: {"query": "<text>", "limit": 5, "session_id": "?<sid>"}`,
    "    use:  search L0 raw conversations (finer grained than atomic_search — exact message text, quotes, timelines). By default searches the current agent's self + imported memories; source_agent_* shows the origin.",
    "    returns: {code, data: {messages: [...], searched_agents: [...]}} — hits are in data.messages[] (note: different from atomic_search's data.items).",
    "  </tool>",
    "",
    "  <tool name=\"tdai_conversation_query\">",
    `    curl: ${bridge}/conversation/query`,
    `    body: {"session_id": "<sid>", "limit": 50, "offset": 0}`,
    "    use:  read L0 history in session order.",
    "  </tool>",
    "",
    "  <tool name=\"tdai_scenario_ls\">",
    `    curl: ${bridge}/scenario/ls`,
    `    body: {"path_prefix": "?optional prefix"}`,
    "    use:  list the L2 scene_blocks path index (with summary, without bodies). The index is normally already injected into the system prompt — use this only to refresh or filter by prefix.",
    "  </tool>",
    "",
    "  <tool name=\"tdai_read_scene\">",
    `    curl: ${bridge}/scenario/read`,
    `    body: {"path": "<scene path>", "agent_id": "?from <agent agent_id=...>; pass it when reading imported memories"}`,
    "    use:  read a full L2 scene file by path. The path must come from `<l2_scene_index>` or tdai_scenario_ls — never invent one; when reading a path under an imported_from section, pass that section's agent_id.",
    "  </tool>",
    "",
    "## Call constraints",
    "- These are read-only tools; to modify L1/L2/L3 use the main pipeline (agent_id is attributed automatically).",
    "- Per turn, atomic_search + conversation_search combined **≤ 3 calls**;",
    "  query / ls / read_scene are not counted, but do not read the same path twice.",
    "- Retries: HTTP 5xx may be retried once; HTTP 4xx must not be retried.",
    "- Every curl must carry: " +
      (spaceId ? `x-tdai-service-id: ${spaceId}, ` : "x-tdai-service-id (current memory instance, see example), ") +
      (sessionId ? `x-conversation-id: ${sessionId}` : "x-conversation-id (from the current session)") +
      "; Content-Type: application/json.",
    "",
    "## Full example",
    "```bash",
    `curl -sfk -X POST ${bridge}/atomic/search \\`,
    `  -H 'Content-Type: application/json'${authHeader} \\`,
    `  -d '{"query": "user preferred programming language", "limit": 5}'`,
    "```",
    "</tdai_memory_tools>",
  ];

  return lines.join("\n");
}
