/**
 * English rendering of `<knowledge_tools>` (fork). Imports the pure helpers from
 * `../knowledge-tools-injector.ts` so attribute/URL rendering cannot drift;
 * `scripts/i18n-parity.ts` asserts the structural tokens match.
 */

import {
  attr,
  deriveRepoSlug,
  renderHeader,
  renderUrlInstantiations,
  xmlAttrEscape,
  type KnowledgeTelemetryContext,
} from "../knowledge-tools-injector.js";
import type { KnowledgeItem } from "../../../knowledge/core-client.js";

export function renderKnowledgeToolsBlockEn(
  resources: KnowledgeItem[],
  serviceId: string,
  telemetryContext: KnowledgeTelemetryContext = {},
  urlsById?: ReadonlyMap<string, string>,
): string | null {
  if (!resources || resources.length === 0) return null;

  const telemetryHeaders: Array<[string, string | undefined]> = [
    ["x-conversation-id", telemetryContext.sessionKey],
    ["x-tdai-user-id", telemetryContext.userId],
    ["x-tdai-team-id", telemetryContext.teamId],
    ["x-tdai-agent-id", telemetryContext.agentId],
    ["x-tdai-agent-source", telemetryContext.agentSource],
    ["x-tdai-space-id", telemetryContext.spaceId],
  ];
  const requestHeaderLines = [
    renderHeader("x-tdai-service-id", serviceId),
    ...telemetryHeaders
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([name, value]) => renderHeader(name, value)),
  ];

  const instantiations = renderUrlInstantiations(
    resources, urlsById, "## Actual endpoint per resource", (u, id) =>
      `- ${id} → \`${u}/tools/list\`, \`${u}/tools/call\``,
  );

  const resourceTags = resources
    .map((r) => {
      const matchAttr = attr("match", r.repo_slug ?? deriveRepoSlug(r.repo_url));
      const branchAttr = attr("branch", r.repo_url ? (r.branch ?? "main") : undefined);
      const summaryAttr = r.type === "wiki" ? attr("about", r.summary) : "";
      return `<knowledge type="${r.type}" id="${r.knowledge_id}"\n  url="${r.service_url}"\n  name="${xmlAttrEscape(r.name)}"${matchAttr}${branchAttr}${summaryAttr} />`;
    })
    .join("\n\n");

  return [
    "<knowledge_tools>",
    "**Team knowledge assets**: code-graph is a prebuilt code index of a repository (symbols / call graph / structure); wiki is engineering design documentation. Each has its own trigger criteria — see below.",
    "",
    "## code-graph: when to call",
    "**Precondition**: the resource's match corresponds to the current workspace (compare git remote / repo name). If it does not match, the index belongs to another repo — use local search, do not probe it.",
    "",
    "Once matched, **use it whenever you need cross-file structural / relational / breadth information**. Typical cases:",
    "- getting familiar with the project, understanding module architecture, finding entry points (cold start)",
    "- locating a symbol, a file, or where a concept is implemented",
    "- following call chains, dependency relationships, data flow",
    "- estimating the blast radius of a change, refactor scope, whether something can be deleted safely (**use it even while you are already editing code**)",
    "- hunting for suspicious code paths while debugging production issues, finding related implementations during review",
    "- not remembering what a capability is called, or whether an implementation already exists (avoid rebuilding it)",
    "",
    "**The only case not to use it**: you need the exact current content of a piece of code — you are editing by line/character, the code is what you just changed, or you are reviewing uncommitted changes. The index is a branch snapshot and lags the workspace; trust the workspace source there.",
    "Building global understanding with it first, then confirming precisely in the file, is a normal combination — they do not conflict.",
    "",
    "## wiki: when to call",
    "wiki is design documentation. It **has no correspondence to the workspace and needs no anchor match** (a missing match attribute is normal and does not mean it is unrelated). Judge relevance by the about attribute.",
    "Use it for \"why is it designed this way / background and trade-offs / how the team defines a concept / past decisions and pitfalls / the design intent of this module\" — answers that cannot be found in the code.",
    "How the code is written → code-graph; the current content of a piece of code → read the source.",
    "",
    "## Intent → starting point",
    "Architecture / getting familiar with the project → explore (returns source along the way in one call); where is X → search; only the definition of a single symbol → node; who calls X / what X calls → callers / callees; blast radius of changing X → search then impact; why designed this way → wiki search then read_page.",
    "Combination: refactor assessment = search → callers → impact.",
    "The source returned by explore / node is verbatim — **no need to Read the same place again** (except the case above where you must confirm the latest content).",
    "",
    "## Bound resources",
    resourceTags,
    "",
    "## How to call (service-level unified endpoints; build the URL from the resource's url)",
    "The target resource is selected by knowledge_id in the body; do **not** put knowledge_id into the URL path.",
    `**Every request must carry the header** \`x-tdai-service-id: ${serviceId}\` (the tenant id; requests without it are rejected).`,
    "",
    "### Step 1: fetch the tool list (once per resource, on **first** use)",
    "curl -sSk -X POST <url>/tools/list \\",
    "  -H 'content-type: application/json' \\",
    ...requestHeaderLines,
    "  -d '{\"knowledge_id\":\"<knowledge id>\"}'",
    "",
    "Returns: {code, message, data:{knowledge_id, type, name, summary, status, tools:[{name, description, params}, ...]}}",
    "Remember the returned tool name / params and **reuse them for the rest of this session**; do not call list repeatedly for the same resource (only if you forgot it).",
    "",
    "### Step 2: execute a tool",
    "curl -sSk -X POST <url>/tools/call \\",
    "  -H 'content-type: application/json' \\",
    ...requestHeaderLines,
    "  -d '{\"knowledge_id\":\"<knowledge id>\", \"tool_name\":\"<name from Step 1>\", \"params\":{...}}'",
    "",
    ...instantiations,
    "Returns: {code, message, data}; code=0 means success.",
    "",
    "## Conventions",
    "- tool_name must match the name returned by tools/list **exactly**, no prefix. params must be a JSON object; pass {} when there are no arguments.",
    "- Use explore / search to find files (query accepts file names directly, e.g. \"session-manager.ts\"); use files only for a one-shot overview of the directory structure, at most once per resource per session.",
    "- For wiki, search first and read_page on a hit; do not list_pages wholesale.",
    "- Multiple resources can be queried in parallel, no need to serialise. Give up after 2 consecutive failures of the same call and fall back to local search.",
    "- Response format is uniformly {code, message, data}; code=0 means success.",
    "</knowledge_tools>\n",
  ].join("\n");
}
