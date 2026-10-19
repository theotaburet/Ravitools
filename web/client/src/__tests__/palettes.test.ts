// --- E3: palettes distinguishable and contrasted (design.md, section 10) ---
// UI tokens are read from index.css itself, family colors from poi-config.ts:
// nothing is typed twice. WCAG 2 contrast; colour-blind vision simulated with
// Machado 2009 (severity 1) in linear sRGB, distances in OKLab.

import { describe, expect, it } from "vitest";
import css from "../index.css?raw";
import { FAMILY_COLORS, POI_CATEGORIES } from "../lib/poi-config";
import type { Palette, PoiFamily } from "../types";

type RGB = [number, number, number];

const linear = (hex: string): RGB =>
  [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as RGB;

function luminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const MACHADO: Record<string, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
};

function oklab(hex: string, vision: string): RGB {
  const c = linear(hex);
  const [r, g, b] = MACHADO[vision].map((row) =>
    Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])),
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Custom properties declared in one CSS block, e.g. `[data-theme="dark"]` */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

/** The tokens in force for a theme and palette, var() references resolved */
function tokens(dark: boolean, cvd: boolean): (name: string) => string {
  const vars = {
    ...block("@theme"),
    ...(dark ? block('[data-theme="dark"]') : {}),
    ...(cvd ? block('[data-palette="cvd"]') : {}),
    ...(dark && cvd ? block('[data-theme="dark"][data-palette="cvd"]') : {}),
  };
  const get = (name: string): string => {
    const value = vars[name];
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    return ref ? get(ref[1]) : value;
  };
  return get;
}

const MODES = [false, true].flatMap((dark) => [false, true].map((cvd) => ({ dark, cvd })));

describe.each(MODES)("UI tokens (dark: $dark, colour-blind: $cvd)", ({ dark, cvd }) => {
  const t = tokens(dark, cvd);

  it.each([
    "--color-ink",
    "--color-ink-muted",
    "--color-accent-text",
    "--color-success-text",
    "--color-warning-text",
    "--color-danger-text",
  ])("%s is at least 4.5:1 on paper and raised paper", (name) => {
    for (const paper of ["--color-paper", "--color-paper-raised"]) {
      expect(contrast(t(name), t(paper)), `${name} on ${paper}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("counter numerals stay near the ceiling in full sun (E2: white, not cyan)", () => {
    // design.md 10, E2: luminance × 800 cd/m² plus 400 cd/m² reflected; the ceiling is 3.00
    const sun = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi * 800 + 400) / (lo * 800 + 400);
    };
    expect(sun(t("--color-screen-ink"), t("--color-screen"))).toBeGreaterThanOrEqual(2.9);
  });

  it("accent labels and the counter screen are at least 4.5:1", () => {
    expect(contrast(t("--color-accent-ink"), t("--color-accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t("--color-screen-ink"), t("--color-screen"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t("--color-screen-label"), t("--color-screen"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("POI families", () => {
  it("every family has categories and every category a family", () => {
    const used = new Set(POI_CATEGORIES.map((c) => c.family));
    expect([...used].sort()).toEqual(Object.keys(FAMILY_COLORS.default).sort());
  });

  it.each(["default", "cvd"] as Palette[])(
    "%s glyphs are at least 3:1 on their family",
    (palette) => {
      for (const [family, { fill, glyph }] of Object.entries(FAMILY_COLORS[palette])) {
        expect(contrast(fill, glyph), family).toBeGreaterThanOrEqual(3);
      }
    },
  );

  // Frozen from the measured spread (closest pair: Sleep/Services under deuteranopia, 0.076)
  const MIN_OKLAB_DISTANCE = 0.07;

  it.each(Object.keys(MACHADO))("the colour-blind palette stays apart under %s", (vision) => {
    const families = Object.entries(FAMILY_COLORS.cvd) as [PoiFamily, { fill: string }][];
    for (const [i, [a, ca]] of families.entries()) {
      for (const [b, cb] of families.slice(i + 1)) {
        const [p, q] = [oklab(ca.fill, vision), oklab(cb.fill, vision)];
        const distance = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        expect(distance, `${a}/${b}`).toBeGreaterThanOrEqual(MIN_OKLAB_DISTANCE);
      }
    }
  });
});
