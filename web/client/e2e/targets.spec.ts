// E6 (web/docs/design.md, section 10), on the Pixel 7 project: in every view, every visible
// control is big enough to tap and the tab's primary button is on screen, not past the fold.

import { expect, type Page, test } from "@playwright/test";
import { loadRoute, stubApi } from "./fixtures";

test.beforeEach(({ page }) => stubApi(page));

/** WCAG 2.5.5 target size (design.md 9) */
const MIN_TARGET_PX = 44;

/** Visible controls under MIN_TARGET_PX; an input inside a label counts as its label, the real target */
function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const controls =
      'button, a[href], input, select, textarea, summary, [role="tab"], [tabindex]:not([tabindex="-1"])';
    const small = new Set<string>();
    for (const el of document.querySelectorAll(controls)) {
      // The attribution links are inline text, which WCAG 2.5.8 exempts
      if (el.closest(".leaflet-control-attribution")) continue;
      const target = (el.matches("input") && el.closest("label")) || el;
      if (!target.checkVisibility()) continue;
      const { width, height } = target.getBoundingClientRect();
      if (width < min || height < min) {
        small.add(`${target.outerHTML.slice(0, 80)}: ${Math.round(width)}x${Math.round(height)}`);
      }
    }
    return [...small];
  }, MIN_TARGET_PX);
}

/** Primary buttons of the open tab that sit past the fold (under the tabs, or below the screen) */
function primariesOutOfSight(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const floor =
      document.querySelector('[role="tablist"]')?.getBoundingClientRect().top ?? innerHeight;
    return [...document.querySelectorAll(".tab-panel:not([hidden]) .btn-primary")]
      .filter((el) => el.checkVisibility() && el.getBoundingClientRect().bottom > floor)
      .map((el) => el.textContent ?? "");
  });
}

async function expectReachable(page: Page): Promise<void> {
  expect(await smallTargets(page)).toEqual([]);
  expect(await primariesOutOfSight(page)).toEqual([]);
}

test("every view keeps tappable targets and its primary action in sight", async ({ page }) => {
  await page.goto("/");
  await expectReachable(page);

  await loadRoute(page);
  await page.locator(".poi-list-item").first().click();
  await expectReachable(page); // the POI detail, ◀ ▶ under the thumb
  await page.getByRole("button", { name: "List" }).click();

  const tabs = page.getByRole("tab");
  for (let i = 0; i < (await tabs.count()); i++) {
    // Tapping the active tab would collapse the sheet: only tap the others
    if ((await tabs.nth(i).getAttribute("aria-selected")) !== "true") await tabs.nth(i).click();
    await expectReachable(page);
  }

  await page.getByRole("button", { name: "Settings" }).click();
  await expectReachable(page);
  await page.getByRole("button", { name: "Debug log" }).click();
  await expectReachable(page);
  // Out of the debug view in one tap, back to the tab it was opened from
  await page.getByRole("button", { name: "Back" }).click();
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
});
