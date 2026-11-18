import { describe, expect, it } from "vitest";
import { ompAdapter } from "../omp.js";

describe("ompAdapter", () => {
  it("treats the title-generator request (one user message, no tools, 1024-token cap) as auxiliary", () => {
    expect(ompAdapter.classifyRequest({
      messages: [{ role: "user", content: "summarise this into a title" }],
      max_tokens: 1024,
    })).toBe("auxiliary");
  });

  it("keeps a normal tool-carrying turn on the main path", () => {
    expect(ompAdapter.classifyRequest({
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16384,
      tools: [{ type: "function" }],
    })).toBe("main");
  });

  it("strips system-reminder parts from the user text", () => {
    expect(ompAdapter.extractUserText([
      { type: "text", text: "<system-reminder>ctx</system-reminder>" },
      { type: "text", text: "mem:help" },
    ])).toBe("mem:help");
  });
});
