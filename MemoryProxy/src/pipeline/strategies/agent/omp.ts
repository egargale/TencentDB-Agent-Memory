/**
 * omp AgentStrategy.
 *
 * omp is a Pi fork: it lives in HEADER_ONLY_AGENTS, so any preset failure or
 * mismatch bypasses instead of emitting a form it cannot render.
 */

import { ompAdapter } from "../../../agent-adapters/omp.js";
import { STAGE_PRESETS, type AgentStrategy } from "./types.js";

export const ompStrategy: AgentStrategy = {
  ...ompAdapter,
  supportsSessionForm: false, // header-only client: no ask_followup_question tool
  bypassOnPresetFail: true,
  stageGates: STAGE_PRESETS.full,
};
