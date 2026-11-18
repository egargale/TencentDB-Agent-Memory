import { describe, expect, it } from "vitest";
import { buildConfig } from "../../config.js";
import { HEADER_ONLY_AGENTS, isHeaderOnlyAgent } from "../preset.js";
import type { TeamOption } from "../types.js";

// 回归: omp (a Pi fork) must take the header-preselect path, not the
// interactive form. omp is a Pi fork with no `ask_followup_question` tool, so
// a form tool_call renders as an unknown tool — same failure mode the header-
// only set already covers for pi/hermes/openclaw (session/preset.ts).
describe("HEADER_ONLY_AGENTS", () => {
  it("treats omp as header-only, like pi", () => {
    expect(isHeaderOnlyAgent("omp")).toBe(true);
    expect(HEADER_ONLY_AGENTS.has("omp")).toBe(true);
  });

  it("still treats the form-capable clients as interactive", () => {
    for (const agent of ["codebuddy", "workbuddy", "dsh", "opencode", "codex", "claude-code"]) {
      expect(isHeaderOnlyAgent(agent)).toBe(false);
    }
  });
});

describe("sessionInit.headerAutoSelect defaults", () => {
  it("ships headerAutoSelect.onMismatch = form (omp would then be bypassed on a stale id)", () => {
    const config = buildConfig({ configFile: "/nonexistent/config.yaml" });
    expect(config.sessionInit?.headerAutoSelect?.enabled).toBe(true);
    expect(config.sessionInit?.headerAutoSelect?.teamHeader).toBe("x-team-id");
    expect(config.sessionInit?.headerAutoSelect?.agentHeader).toBe("x-agent-id");
    expect(config.sessionInit?.headerAutoSelect?.onMismatch).toBe("form");
  });
});

describe("TeamOption shape", () => {
  it("exposes the agents/tasks the preset validator matches against", () => {
    const team: TeamOption = {
      team_id: "team-1",
      team_name: "coding",
      agents: [{ agent_id: "agt-1", agent_name: "Coder" }],
      tasks: [],
    };
    expect(team.agents[0].agent_id).toBe("agt-1");
  });
});
