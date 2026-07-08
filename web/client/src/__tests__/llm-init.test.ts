// ---------------------------------------------------------------------------
// R18: two concurrent initEngine() calls must share one model download
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

const chatCreate = vi.hoisted(() =>
  vi.fn(async () => ({
    choices: [{ message: { content: "not acceptable" } }],
  })),
);
const createMLCEngine = vi.hoisted(() =>
  vi.fn(
    () =>
      new Promise((resolve) => {
        setTimeout(
          () => resolve({ unload: vi.fn(), chat: { completions: { create: chatCreate } } }),
          10,
        );
      }),
  ),
);

vi.mock("@mlc-ai/web-llm", () => ({ CreateMLCEngine: createMLCEngine }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initEngine in-flight guard (R18)", () => {
  it("two concurrent calls invoke the engine factory once", async () => {
    vi.stubGlobal("navigator", { gpu: {} });
    const { initEngine, resetLlmState, isWebGpuAvailable } = await import("../lib/enrichment/llm");
    expect(isWebGpuAvailable()).toBe(true);
    resetLlmState();

    const [a, b] = await Promise.all([initEngine(), initEngine()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(createMLCEngine).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// R23: after MAX_REPAIR_ATTEMPTS a still-rejected synthesis must return null
// (deterministic builder takes over), not the bad output
// ---------------------------------------------------------------------------

describe("synthesize repair exhaustion (R23)", () => {
  it("returns null when every repair attempt is still rejected", async () => {
    vi.stubGlobal("navigator", { gpu: {} });
    const { initEngine, resetLlmState, synthesize } = await import("../lib/enrichment/llm");
    resetLlmState();
    // English output while targetLanguage is fr → rejected on every attempt
    chatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"description": "This place has great food and the staff was friendly", "review": "Highly recommend this place"}',
          },
        },
      ],
    });
    await initEngine();

    const result = await synthesize(
      "Bistro",
      "restaurant",
      [{ title: "t", url: "https://x.example", content: "c", engine: "google" }],
      "fr",
    );

    expect(chatCreate.mock.calls.length).toBeGreaterThan(1); // repairs were attempted
    expect(result).toBeNull();
  });
});
