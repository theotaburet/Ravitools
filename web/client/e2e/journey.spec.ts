// E7 (web/docs/design.md, section 10), on desktop and Pixel 7: the main journeys, with one
// failing Overpass chunk. After each step: no covered control, no page overflow, no
// clipped or overflowing text, no retry prompt; at the end: few taps and no layout shift.

import { expect, type Locator, type Page, test } from "@playwright/test";
import { loadRoute, stubApi } from "./fixtures";

declare global {
  interface Window {
    __cls: number;
  }
}

/** Layout-shift score since load (shifts right after an input do not count) */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!e.hadRecentInput) window.__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
});

/** Friction on screen now: covered controls, page overflow, text clipped without an ellipsis */
function friction(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    if (document.documentElement.scrollWidth > innerWidth) found.push("page overflows sideways");
    // Content scrolls under the floating tabs on purpose: only look above them
    const floor =
      document.querySelector('[role="tablist"]')?.getBoundingClientRect().top ?? innerHeight;
    for (const el of document.querySelectorAll(
      'button, a[href], input, select, summary, [role="tab"]',
    )) {
      // Map markers sit under the sheet by design
      if (el.closest(".leaflet-marker-pane") || !el.checkVisibility()) continue;
      const target = (el.matches("input") && el.closest("label")) || el;
      const r = target.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const inTabs = target.closest('[role="tablist"]') !== null;
      if (x < 0 || x > innerWidth || y < 0 || y > (inTabs ? innerHeight : floor)) continue;
      const scroller = target.closest(".tab-panel")?.getBoundingClientRect();
      if (scroller && (y < scroller.top || y > scroller.bottom)) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && !target.contains(hit) && !hit.contains(target)) {
        found.push(`covered: ${name(target)} by ${name(hit)}`);
      }
    }
    for (const el of document.querySelectorAll("body *")) {
      // Screen-reader-only text is 1 px wide on purpose
      if (!el.checkVisibility() || el.clientWidth <= 1 || el.closest(".leaflet-container"))
        continue;
      if (!el.textContent?.trim()) continue;
      // A label wider than its button spills onto its neighbours
      if (el.matches("button") && el.scrollWidth > el.clientWidth + 1) {
        found.push(`overflowing: ${name(el)}`);
      }
      const css = getComputedStyle(el);
      if (
        el.scrollWidth > el.clientWidth + 1 &&
        css.overflowX === "hidden" &&
        css.textOverflow !== "ellipsis"
      ) {
        found.push(`clipped: ${name(el)}`);
      }
    }
    return found;
  });
}

function journal(page: Page) {
  const issues: string[] = [];
  let taps = 0;
  return {
    issues,
    taps: () => taps,
    tap: async (target: Locator) => {
      taps++;
      await target.click();
    },
    countTap: () => taps++,
    check: async (step: string) => {
      for (const issue of await friction(page)) issues.push(`${step}: ${issue}`);
      await expect(page.getByRole("button", { name: /retry|try again/i })).toHaveCount(0);
    },
  };
}

test("load, keep the water, open a POI, next, export: no friction despite a failing chunk", async ({
  page,
  isMobile,
}) => {
  test.slow(); // the failing chunk waits out the 10 s retry backoff
  await stubApi(page, { failingChunks: 1 });
  const j = journal(page);

  await page.goto("/");
  await j.check("empty");

  j.countTap(); // choosing the file
  const chosenAt = Date.now();
  await loadRoute(page);
  test.info().annotations.push({ type: "first POI", description: `${Date.now() - chosenAt} ms` });
  await j.check("loaded");

  await j.tap(page.getByRole("button", { name: "None" }));
  await j.tap(page.getByRole("button", { name: /^Water/ })); // the family toggle
  await expect(page.locator(".poi-list-item")).toHaveCount(2);
  await j.check("water only");

  await j.tap(page.locator(".poi-list-item").first());
  await expect(page.locator(".poi-detail h2")).toBeFocused();
  await j.check("POI detail");

  // The list is in route order: the next water point down the road
  await j.tap(page.getByRole("button", { name: "Next POI" }));
  await expect(page.locator(".poi-detail h2")).toHaveText("Fontaine Wallace");
  await j.check("next POI");

  await j.tap(page.getByRole("tab", { name: /Export/ }));
  const download = page.waitForEvent("download");
  await j.tap(page.getByRole("button", { name: /^GPX COROS/ }));
  await download;
  await j.check("exported");

  expect(j.issues).toEqual([]);
  if (isMobile) expect(j.taps()).toBeLessThanOrEqual(8);
  expect(await page.evaluate(() => window.__cls)).toBeLessThanOrEqual(0.1);
});

test("resume a saved session in one tap", async ({ page }) => {
  await stubApi(page);
  await page.goto("/");
  await loadRoute(page);
  await page.reload();

  const j = journal(page);
  await j.check("resume prompt");
  await j.tap(page.getByRole("button", { name: "Resume" }));
  await expect(page.getByRole("tab", { name: /POI/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".poi-list-item").first()).toBeVisible();
  await j.check("resumed");
  expect(j.issues).toEqual([]);
});

test("a POI deep in a long list opens, and back gives its row the focus", async ({ page }) => {
  await stubApi(page, { longList: true });
  await page.goto("/");
  await loadRoute(page);

  await page.locator(".tab-panel:not([hidden])").evaluate((el) => el.scrollBy(0, 4000));
  // The virtualizer renders the scrolled range a frame later: pick a row once it has
  await expect(page.locator('.poi-list-item[data-index="0"]')).toHaveCount(0);
  const id = await page.locator(".poi-list-item").nth(10).getAttribute("data-poi-id");
  await page.locator(`[data-poi-id="${id}"]`).click();
  await expect(page.locator(".poi-detail h2")).toBeFocused();

  await page.getByRole("button", { name: "List" }).click();
  await expect(page.locator(`[data-poi-id="${id}"]`)).toBeFocused();
});
