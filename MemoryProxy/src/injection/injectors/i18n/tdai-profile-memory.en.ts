/**
 * English rendering of the TDAI profile-memory block (fork): header line plus
 * `<memory-tools-guide>`. Must keep the same `<...>` tags and tool names as
 * `../tdai-profile-memory-injector.ts` — `scripts/i18n-parity.ts` asserts it.
 */

export const PROFILE_HEADER_EN =
  "Below is the long-term work memory TDAI maintains for the current agent (own segments + imported segments; L2 is index-only — read bodies with the tools when needed):";

export const MEMORY_TOOLS_GUIDE_EN = `<memory-tools-guide>
## ⚠️ Important: this is not documentation, it is a capability you have

The tdai_memory_search / tdai_conversation_search tools listed in \`<tdai_memory_tools>\`
are **capabilities you can call** (not reference docs). They are used through **Bash + curl**
(see the full call instructions and URLs in the \`<tdai_memory_tools>\` block above).

**Never** answer with "I don't have that tool / I need an MCP / I need a slash command".
**Correct approach**: when a memory lookup is warranted, run curl from Bash directly; the proxy injects identity and auth automatically.

## Memory rules (query first, then answer, in these situations)

L3 (persona / long-term profile) and the L2 scene index are already injected into the system prompt. L0/L1 must be retrieved with the tools.
If the injected L2 content is relevant to the current task but not sufficient, read the body via \`tdai_read_scene\` using the path from the scene index; if it is already sufficient, no read is needed.

### Situations where you MUST query memory before answering (any one triggers a tool call)

1. **The user refers to history / the past / earlier**: e.g. "I said before / I told you / last time / do you remember / we discussed / that thing from before"
   → use \`tdai_conversation_search\` (find the exact message in L0)
2. **The user refers to their own identity / preferences / habits**: e.g. "what's my name / my name / I like / my team / I usually use / I don't like / I don't allow"
   → use \`tdai_memory_search\` (L1 atomic memories for preferences/rules)
3. **The user asks you to recall or find something**: e.g. "recall / remember / find / is there any record about X / check what we did before"
   → trigger the tool directly, never answer from thin air
4. **The answer depends on historical facts**: e.g. "how did we fix that bug / what was the last plan / what did we agree on"
   → turn it into keywords, then \`tdai_memory_search\`

**Typical flow** (user: "what's my name"):
\`\`\`bash
# Step 1: query first
curl -sfk -X POST <bridge>/atomic/search \\
  -H 'Content-Type: application/json' -H 'x-conversation-id: <sid>' \\
  -d '{"query": "user name identity", "limit": 5}'
# Step 2: extract the answer from items[].content, then reply
# If empty: tell the user plainly "I could not find it in memory — what is your name?" Never pretend to know
\`\`\`

### Situations that need no lookup

- Requests that do not depend on history or past experience and can be completed from the current input alone; do not decide from task type alone
- The current session context (messages in this turn) already answers it
- The answer is already visible in the \`<l3_core_memory>\` section

### ⚠️ Call constraints

- Per turn, \`tdai_memory_search\` + \`tdai_conversation_search\` combined **≤ 3 calls** (\`tdai_read_scene\` / \`tdai_scenario_ls\` / \`tdai_atomic_query\` are not counted)
- When retrieval finds nothing, **state it plainly** — "I could not find X in memory" — do not invent
- Do not read the same L2 path twice
</memory-tools-guide>`;
