// ---------------------------------------------------------------------------
// Browser context (shared session) tests
//
// Covers:
// - Lazy creation: getBrowserContext returns the same instance across calls
// - storageState load: when state file exists, options.storageState is set
// - storageState save: writes JSON to disk (with debounce respected)
// - close: flushes state and resets the singleton
//
// Playwright is fully mocked — no real Chromium is launched.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";

const TMP_CWD = join(process.cwd(), ".test-browser-ctx-tmp");
const STATE_DIR = join(TMP_CWD, ".cache");
const STATE_FILE = join(STATE_DIR, "browser-state.json");

let originalCwd: string;

function makeFakeContext() {
  return {
    newPage: vi.fn(),
    storageState: vi.fn(async () => ({
      cookies: [{ name: "NID", value: "abc", domain: ".google.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
      origins: [],
    })),
    close: vi.fn(async () => undefined),
    on: vi.fn(),
  };
}

function makeFakeBrowser(ctx: ReturnType<typeof makeFakeContext>) {
  return {
    newContext: vi.fn(async () => ctx),
  } as unknown as import("playwright").Browser;
}

beforeEach(() => {
  originalCwd = process.cwd();
  if (existsSync(TMP_CWD)) rmSync(TMP_CWD, { recursive: true, force: true });
  mkdirSync(TMP_CWD, { recursive: true });
  process.chdir(TMP_CWD);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(originalCwd);
  if (existsSync(TMP_CWD)) rmSync(TMP_CWD, { recursive: true, force: true });
});

describe("browser-context", () => {
  it("lazily creates a single context across multiple calls", async () => {
    const mod = await import("../browser-context");
    mod._resetBrowserContextForTests();

    const ctx = makeFakeContext();
    const browser = makeFakeBrowser(ctx);

    const c1 = await mod.getBrowserContext(browser);
    const c2 = await mod.getBrowserContext(browser);

    expect(c1).toBe(c2);
    expect((browser as unknown as { newContext: { mock: { calls: unknown[] } } }).newContext.mock.calls).toHaveLength(1);
  });

  it("loads storageState from disk if present", async () => {
    mkdirSync(STATE_DIR, { recursive: true });
    const stored = { cookies: [{ name: "NID", value: "from-disk", domain: ".google.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] };
    writeFileSync(STATE_FILE, JSON.stringify(stored), "utf8");

    const mod = await import("../browser-context");
    mod._resetBrowserContextForTests();

    const ctx = makeFakeContext();
    const browser = makeFakeBrowser(ctx);

    await mod.getBrowserContext(browser);

    const newContextSpy = (browser as unknown as { newContext: { mock: { calls: { 0: { storageState?: unknown } }[] } } }).newContext;
    const passedOptions = newContextSpy.mock.calls[0][0];
    expect(passedOptions.storageState).toBeDefined();
    expect((passedOptions.storageState as { cookies: { value: string }[] }).cookies[0].value).toBe("from-disk");
  });

  it("does not pass storageState when no file exists", async () => {
    const mod = await import("../browser-context");
    mod._resetBrowserContextForTests();

    const ctx = makeFakeContext();
    const browser = makeFakeBrowser(ctx);

    await mod.getBrowserContext(browser);

    const newContextSpy = (browser as unknown as { newContext: { mock: { calls: { 0: { storageState?: unknown } }[] } } }).newContext;
    expect(newContextSpy.mock.calls[0][0].storageState).toBeUndefined();
  });

  it("saveBrowserState writes JSON to disk on first call (forced)", async () => {
    const mod = await import("../browser-context");
    mod._resetBrowserContextForTests();

    const ctx = makeFakeContext();
    const browser = makeFakeBrowser(ctx);

    await mod.getBrowserContext(browser);
    await mod.saveBrowserState(true);

    expect(existsSync(STATE_FILE)).toBe(true);
    const written = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    expect(written.cookies[0].name).toBe("NID");
  });

  it("saveBrowserState is debounced (second non-forced call within 30s skips I/O)", async () => {
    const mod = await import("../browser-context");
    mod._resetBrowserContextForTests();

    const ctx = makeFakeContext();
    const browser = makeFakeBrowser(ctx);

    await mod.getBrowserContext(browser);
    await mod.saveBrowserState(true); // first save (forced)
    expect(ctx.storageState).toHaveBeenCalledTimes(1);

    await mod.saveBrowserState(false); // should be skipped (debounce)
    expect(ctx.storageState).toHaveBeenCalledTimes(1);

    await mod.saveBrowserState(true); // forced bypass
    expect(ctx.storageState).toHaveBeenCalledTimes(2);
  });

  it("saveBrowserState does nothing if context never created", async () => {
    const mod = await import("../browser-context");
    mod._resetBrowserContextForTests();

    // No getBrowserContext call -> no context yet
    await mod.saveBrowserState(true);
    expect(existsSync(STATE_FILE)).toBe(false);
  });

  it("closeBrowserContext flushes state and clears singleton", async () => {
    const mod = await import("../browser-context");
    mod._resetBrowserContextForTests();

    const ctx = makeFakeContext();
    const browser = makeFakeBrowser(ctx);

    const first = await mod.getBrowserContext(browser);
    await mod.closeBrowserContext();

    expect(ctx.close).toHaveBeenCalled();
    expect(existsSync(STATE_FILE)).toBe(true); // state flushed

    // After close, a new call creates a fresh context
    const ctx2 = makeFakeContext();
    const browser2 = makeFakeBrowser(ctx2);
    const second = await mod.getBrowserContext(browser2);
    expect(second).not.toBe(first);
    expect(second).toBe(ctx2);
  });

  it("gracefully handles unreadable storage state file", async () => {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, "{ malformed json", "utf8");

    const mod = await import("../browser-context");
    mod._resetBrowserContextForTests();

    const ctx = makeFakeContext();
    const browser = makeFakeBrowser(ctx);

    // Should not throw, should fall back to no storageState
    const c = await mod.getBrowserContext(browser);
    expect(c).toBe(ctx);

    const newContextSpy = (browser as unknown as { newContext: { mock: { calls: { 0: { storageState?: unknown } }[] } } }).newContext;
    expect(newContextSpy.mock.calls[0][0].storageState).toBeUndefined();
  });
});
