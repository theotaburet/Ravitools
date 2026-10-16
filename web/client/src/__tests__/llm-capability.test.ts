// Local LLM capability check: pure verdict + navigator probe.
// The verdict decides whether AI synthesis is on by default, so the thresholds
// are asserted explicitly here.

import { describe, expect, it } from "vitest";
import {
  assessLlmCapability,
  type GpuProbe,
  probeLlmCapability,
} from "../lib/enrichment/capability";

const GIB = 2 ** 30;

const desktop: GpuProbe = {
  webgpu: true,
  adapter: true,
  fallbackAdapter: false,
  maxBufferSize: 4 * GIB,
  deviceMemoryGb: 8,
  mobile: false,
  gpuName: "Apple M2",
};

describe("assessLlmCapability", () => {
  it("is unsupported without WebGPU", () => {
    const cap = assessLlmCapability({ webgpu: false, adapter: false });
    expect(cap.level).toBe("unsupported");
    expect(cap.reasons).toEqual(["no-webgpu"]);
  });

  it("is unsupported when WebGPU exists but no adapter is returned", () => {
    const cap = assessLlmCapability({ webgpu: true, adapter: false });
    expect(cap.level).toBe("unsupported");
    expect(cap.reasons).toEqual(["no-adapter"]);
  });

  it("is unsupported on a software (fallback) adapter", () => {
    const cap = assessLlmCapability({ ...desktop, fallbackAdapter: true });
    expect(cap.level).toBe("unsupported");
    expect(cap.reasons).toEqual(["software-adapter"]);
  });

  it("is ready on a desktop GPU with enough memory", () => {
    const cap = assessLlmCapability(desktop);
    expect(cap.level).toBe("ready");
    expect(cap.reasons).toEqual([]);
    expect(cap.gpuName).toBe("Apple M2");
    expect(cap.modelSizeMb).toBeGreaterThan(2000);
  });

  it("is limited below 8 GB of device memory", () => {
    const cap = assessLlmCapability({ ...desktop, deviceMemoryGb: 4 });
    expect(cap.level).toBe("limited");
    expect(cap.reasons).toEqual(["low-memory"]);
  });

  it("is limited on mobile and on small GPU buffers, listing every reason", () => {
    const cap = assessLlmCapability({ ...desktop, mobile: true, maxBufferSize: 256 * 2 ** 20 });
    expect(cap.level).toBe("limited");
    expect(cap.reasons).toEqual(["small-buffers", "mobile"]);
  });

  it("stays ready when device memory is unknown (Firefox, Safari)", () => {
    const cap = assessLlmCapability({ ...desktop, deviceMemoryGb: undefined });
    expect(cap.level).toBe("ready");
  });
});

describe("probeLlmCapability", () => {
  it("reads adapter limits and info from navigator.gpu", async () => {
    const nav = {
      userAgent: "Mozilla/5.0 (Macintosh)",
      deviceMemory: 8,
      gpu: {
        requestAdapter: async () => ({
          isFallbackAdapter: false,
          limits: { maxBufferSize: 4 * GIB },
          info: { vendor: "apple", architecture: "metal-3", description: "" },
        }),
      },
    } as unknown as Navigator;
    const cap = await probeLlmCapability(nav);
    expect(cap.level).toBe("ready");
    expect(cap.gpuName).toBe("apple metal-3");
  });

  it("is unsupported when navigator has no gpu", async () => {
    const cap = await probeLlmCapability({ userAgent: "x" } as unknown as Navigator);
    expect(cap.level).toBe("unsupported");
    expect(cap.reasons).toEqual(["no-webgpu"]);
  });

  it("flags a phone user agent as limited", async () => {
    const nav = {
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile",
      gpu: {
        requestAdapter: async () => ({
          isFallbackAdapter: false,
          limits: { maxBufferSize: 4 * GIB },
        }),
      },
    } as unknown as Navigator;
    const cap = await probeLlmCapability(nav);
    expect(cap.level).toBe("limited");
    expect(cap.reasons).toEqual(["mobile"]);
    expect(cap.gpuName).toBeUndefined();
  });
});
