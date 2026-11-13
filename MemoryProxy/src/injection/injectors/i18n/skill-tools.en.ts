/**
 * English rendering of `<skill_tools>` (fork). Tool names, `path:` URLs, header
 * names and error codes must match `../skill-tools-injector.ts` —
 * `scripts/i18n-parity.ts` asserts it.
 */

export function renderSkillToolsBlockEn(
  proxyBaseUrl: string,
  allowLlmWrite = true,
  sessionId?: string,
  spaceId?: string,
): string {
  const base = proxyBaseUrl.replace(/\/$/, "");
  const bridge = `${base}/skill-bridge/v3/skill`;

  const sessionHeader = sessionId ? ` -H 'x-conversation-id: ${sessionId}'` : "";
  const tenantHeader = spaceId ? ` -H 'x-tdai-service-id: ${spaceId}'` : "";
  const authHeader = `${tenantHeader}${sessionHeader}`;

  const skillViewMode = (process.env.SKILL_VIEW_MODE ?? "id").toLowerCase() === "name" ? "name" : "id";
  const skillViewTool =
    skillViewMode === "id"
      ? [
          `  <tool name="skill_view">`,
          `    path: ${bridge}/get`,
          `    body: {"skill_id": "<the skill's id, like skl-xxx>", "include_content": true, "include_manifest": true}`,
          `    use:  **the entry point for opening a skill**: returns the full SKILL.md plus the resource tree (manifest). To read the bytes of a resource file you must first call this and pick the path from the manifest, then use skill_files_read. skill_id comes from the \`id=\` field on each <available_skills> line (like skl-xxxxxx), or the skill_id field in skill_search results.`,
          `  </tool>`,
        ]
      : [
          `  <tool name="skill_view">`,
          `    path: ${bridge}/get-by-name`,
          `    body: {"skill_name": "<skill name>", "include_content": true, "include_manifest": true}`,
          `    use:  **the entry point for opening a skill**: returns the full SKILL.md plus the resource tree (manifest). To read the bytes of a resource file you must first call this and pick the path from the manifest, then use skill_files_read. skill_name is the name from \`- name: description\` in <available_skills>, or the name field in skill_search results.`,
          `  </tool>`,
        ];

  const readTools = [
    `  <tool name="skill_search">`,
    `    path: ${bridge}/search`,
    `    body: {"query": "keywords describing the skill you are looking for (required, >=1 char)"}`,
    `    use:  keyword + semantic search over the skills **you have permission to access in the team** (across agents, but **excluding** skills others marked private — same as the "team assets" tab in the UI). query must be a non-empty string; prefer 2-5 related keywords. Use it when your own skills are not enough to discover others available in the team. The result count is fixed server-side; if results are poor, retry with a different keyword set — do not add top_k/mode or other fields to the body (they are ignored).`,
    `  </tool>`,
    "",
    ...skillViewTool,
    "",
    `  <tool name="skill_files_read">`,
    `    path: ${bridge}/files/read`,
    `    body: {"skill_id": "skl-xxx", "path": "scripts/run.sh", "encoding": "utf-8|base64"}`,
    `    use:  read a single resource file. **You must call skill_view first to get the manifest**, then pick skill_id + path from it, otherwise this tool cannot locate the file. Returns a JSON envelope by default (bytes as base64/utf-8).\n    To download locally: append -o <local path> to curl and the proxy returns raw bytes written straight to the file, keeping them out of the context. Downloaded scripts need chmod +x before running.`,
    `  </tool>`,
    "",
    `  <tool name="skill_extract">`,
    `    path: ${bridge}/extract`,
    `    body: {"reason": "?optional — briefly say why this conversation is worth extracting as a skill (clarity helps the background extractor find the boundaries)"}`,
    `    use:  archive the current conversation and trigger one skill extraction immediately (async job; a background agent analyses the conversation and writes a skill). The proxy takes identity from the session and the conversation buffer accumulated on the core side, so you do not pass messages. Use it when "the user just completed an end-to-end flow worth reusing".`,
    `  </tool>`,
  ];

  const writeTools = [
    `  <tool name="skill_create">`,
    `    path: ${bridge}/create`,
    `    body: {"name": "string", "content": "full SKILL.md (with frontmatter)", "resources": "?optional array"}`,
    `    use:  create a skill; owner is set automatically to the current agent`,
    `  </tool>`,
    "",
    `  <tool name="skill_update">`,
    `    path: ${bridge}/update`,
    `    body: {"skill_id": "skl-xxx", "content": "new SKILL.md"}`,
    `    use:  replace SKILL.md (version+1)`,
    `  </tool>`,
    "",
    `  <tool name="skill_patch">`,
    `    path: ${bridge}/patch`,
    `    body: {"skill_id": "skl-xxx", "old_string": "...", "new_string": "...", "replace_all": false}`,
    `    use:  substring replacement in SKILL.md (avoids large diffs)`,
    `  </tool>`,
    "",
    `  <tool name="skill_delete">`,
    `    path: ${bridge}/delete`,
    `    body: {"skill_id": "skl-xxx"}`,
    `    use:  hard-delete every version of the skill`,
    `  </tool>`,
    "",
    `  <tool name="skill_files_write">`,
    `    path: ${bridge}/files/write`,
    `    body: {"skill_id": "skl-xxx", "files": [{"path": "scripts/x.sh", "content": "...", "encoding": "utf-8", "is_executable": true}]}`,
    `    use:  add or modify resource files (version+1)`,
    `  </tool>`,
    "",
    `  <tool name="skill_files_remove">`,
    `    path: ${bridge}/files/remove`,
    `    body: {"skill_id": "skl-xxx", "paths": ["scripts/old.sh"]}`,
    `    use:  delete resource files (version+1)`,
    `  </tool>`,
  ];

  const note = allowLlmWrite
    ? "Error handling: responses use the `{code, message, request_id, data?}` envelope; `code != 0` means a business error. Common ones:"
    : "Note: only read-only operations are enabled. To create or modify skills, contact an administrator.\nError handling: responses use the `{code, message, request_id, data?}` envelope; `code != 0` means a business error. Common ones:";

  const readErrors = [
    "- 40001 parameter validation failed: a body field is missing or malformed — see the field name in message.",
    "- 40101 session not initialized: the session was not recognised (most likely you called this tool in the wrong conversation context).",
    "- 40401 SKILL_NOT_FOUND: the skill does not exist or does not belong to your agent; use skill_search to find a similar one.",
    "- 50301 upstream unavailable: the core side is temporarily unreachable, retry later.",
  ];
  const writeErrors = [
    "- 40301 SKILL_NOT_OWNER: you are not the owner and cannot modify it.",
    "- 40901 SKILL_VERSION_STALE: stale version — call skill_view to get the latest before writing.",
    "- 42201 SKILL_NAME_DUPLICATE: the name already exists in this team.",
    "- 42202 SKILL_PATCH_NOT_UNIQUE: old_string is not unique, pass replace_all=true.",
  ];

  return [
    "<skill_tools>",
    "Below are the cloud skill tools. **These are not local tools** — call them from Bash with curl against the proxy's skill-bridge paths.",
    "The proxy injects identity and auth automatically (user_id / team_id / agent_id come from the session), so the body only carries business fields.",
    "",
    "Call template:",
    `  curl -sSk -X POST <bridge>/<action> -H 'content-type: application/json'${authHeader} -d '{...business fields...}'`,
    `  where <bridge> = ${bridge}`,
    "",
    "Available tools:",
    "",
    ...readTools,
    ...(allowLlmWrite ? [""] : []),
    ...(allowLlmWrite ? writeTools : []),
    "",
    note,
    ...readErrors,
    ...(allowLlmWrite ? writeErrors : []),
    "</skill_tools>",
  ].join("\n");
}
