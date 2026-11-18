import { describe, expect, it } from "vitest";
import { resolveConversationIdFromBody, stripBodyConversationMarker } from "../session-key.js";
import { parseMemCommand } from "../../mem-command/parser.js";

const marked = (id: string, text = "hello") => `[tdai-conversation-id:${id}]\n${text}`;

describe("resolveConversationIdFromBody (header-less clients, e.g. omp)", () => {
  it("reads the marker from the first user message", () => {
    expect(resolveConversationIdFromBody({
      messages: [{ role: "system", content: "sys" }, { role: "user", content: marked("omp-abc-123") }],
    })).toBe("omp-abc-123");
  });

  it("reads the marker from array content parts", () => {
    expect(resolveConversationIdFromBody({
      messages: [{ role: "user", content: [{ type: "text", text: marked("omp-xyz") }] }],
    })).toBe("omp-xyz");
  });

  it("returns null when no marker is present", () => {
    expect(resolveConversationIdFromBody({
      messages: [{ role: "user", content: "plain prompt" }],
    })).toBeNull();
  });

  it("ignores a marker that only appears after the first user message", () => {
    expect(resolveConversationIdFromBody({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: marked("omp-late") },
      ],
    })).toBeNull();
  });

  it("returns null for a body without messages", () => {
    expect(resolveConversationIdFromBody({})).toBeNull();
    expect(resolveConversationIdFromBody(null)).toBeNull();
  });

  it("ignores a marker quoted inside the message", () => {
    expect(resolveConversationIdFromBody({
      messages: [{ role: "user", content: "see [tdai-conversation-id:omp-abc] in the log" }],
    })).toBeNull();
  });

  it("ignores a marker that is not on the first text part", () => {
    expect(resolveConversationIdFromBody({
      messages: [{
        role: "user",
        content: [{ type: "text", text: "hello" }, { type: "text", text: marked("omp-second") }],
      }],
    })).toBeNull();
  });
});

describe("stripBodyConversationMarker", () => {
  it("removes the leading marker so first-turn mem: commands still parse", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: marked("omp-abc-123", "mem:help") }],
    };

    stripBodyConversationMarker(body);

    const content = (body.messages as Array<{ content: string }>)[0].content;
    expect(content).toBe("mem:help");
    expect(parseMemCommand(body, "omp")?.command).toBe("help");
  });

  it("removes the marker from the first text part", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: [{ type: "text", text: marked("omp-xyz", "hi") }] }],
    };

    stripBodyConversationMarker(body);

    const parts = (body.messages as Array<{ content: Array<{ text: string }> }>)[0].content;
    expect(parts[0].text).toBe("hi");
  });

  it("leaves a marker quoted inside the message alone", () => {
    const content = "why does [tdai-conversation-id:omp-abc] show up?";
    const body: Record<string, unknown> = { messages: [{ role: "user", content }] };

    stripBodyConversationMarker(body);

    expect((body.messages as Array<{ content: string }>)[0].content).toBe(content);
  });
});
