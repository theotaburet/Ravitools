// --- Local LLM capability: can this machine run the WebLLM model well? ---
// Pure verdict (assessLlmCapability) + a navigator probe (probeLlmCapability).
// The verdict gates AI synthesis by default: the 3B model on a 4 GB laptop or
// on a phone tends to kill the tab, which is worse than raw search snippets.

import { MODEL_VRAM_MB } from "./llm";

export type LlmCapabilityLevel = "ready" | "limited" | "unsupported";

export type LlmCapabilityReason =
  | "no-webgpu"
  | "no-adapter"
  | "software-adapter"
  | "small-buffers"
  | "low-memory"
  | "mobile";

export interface GpuProbe {
  webgpu: boolean;
  adapter: boolean;
  fallbackAdapter?: boolean;
  /** adapter.limits.maxBufferSize, in bytes */
  maxBufferSize?: number;
  /** navigator.deviceMemory in GB (Chromium only, capped at 8) */
  deviceMemoryGb?: number;
  mobile?: boolean;
  gpuName?: string;
}

export interface LlmCapability {
  level: LlmCapabilityLevel;
  reasons: LlmCapabilityReason[];
  gpuName?: string;
  /** Weights downloaded on first use, then served from the browser cache */
  modelSizeMb: number;
}

/** Below 1 GiB the weight shards cannot be bound as single GPU buffers */
const MIN_BUFFER_BYTES = 2 ** 30;
/** deviceMemory is capped at 8 by the browser: anything lower really is lower */
const MIN_DEVICE_MEMORY_GB = 8;

export function assessLlmCapability(p: GpuProbe): LlmCapability {
  const base = { gpuName: p.gpuName, modelSizeMb: MODEL_VRAM_MB };
  if (!p.webgpu) return { ...base, level: "unsupported", reasons: ["no-webgpu"] };
  if (!p.adapter) return { ...base, level: "unsupported", reasons: ["no-adapter"] };
  if (p.fallbackAdapter) return { ...base, level: "unsupported", reasons: ["software-adapter"] };
  const reasons: LlmCapabilityReason[] = [];
  if (p.maxBufferSize !== undefined && p.maxBufferSize < MIN_BUFFER_BYTES) {
    reasons.push("small-buffers");
  }
  if (p.deviceMemoryGb !== undefined && p.deviceMemoryGb < MIN_DEVICE_MEMORY_GB) {
    reasons.push("low-memory");
  }
  if (p.mobile) reasons.push("mobile");
  return { ...base, level: reasons.length > 0 ? "limited" : "ready", reasons };
}

// WebGPU is not in the TS DOM lib yet: the minimal structural shape we read.
interface GpuAdapterLike {
  isFallbackAdapter?: boolean;
  limits?: { maxBufferSize?: number };
  info?: { vendor?: string; architecture?: string; description?: string };
}

interface NavigatorLike {
  userAgent: string;
  deviceMemory?: number;
  gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> };
}

/** Ask the browser about its GPU; never throws, never loads the model. */
export async function probeLlmCapability(nav: Navigator = navigator): Promise<LlmCapability> {
  const n = nav as unknown as NavigatorLike;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(n.userAgent);
  if (!n.gpu) return assessLlmCapability({ webgpu: false, adapter: false, mobile });

  let adapter: GpuAdapterLike | null = null;
  try {
    adapter = await n.gpu.requestAdapter();
  } catch {
    adapter = null;
  }
  if (!adapter) return assessLlmCapability({ webgpu: true, adapter: false, mobile });

  const info = adapter.info;
  const vendorArch = [info?.vendor, info?.architecture].filter(Boolean).join(" ");
  const gpuName = info?.description || vendorArch || undefined;
  return assessLlmCapability({
    webgpu: true,
    adapter: true,
    fallbackAdapter: adapter.isFallbackAdapter === true,
    maxBufferSize: adapter.limits?.maxBufferSize,
    deviceMemoryGb: n.deviceMemory,
    mobile,
    gpuName,
  });
}
