// --- lucide icons: a React element for the UI, an SVG string for Leaflet divIcons ---

import type { IconNode } from "lucide";
import { createElement } from "react";

const SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export function Icon({ node, size = 20 }: { node: IconNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {node.map(([tag, attrs]) => createElement(tag, { key: JSON.stringify(attrs), ...attrs }))}
    </svg>
  );
}

/** The same icon as markup (lucide attributes are plain SVG: numbers and path data) */
export function iconSvg(node: IconNode, size = 16): string {
  const children = node
    .map(([tag, attrs]) => {
      const pairs = Object.entries(attrs).map(([k, v]) => `${k}="${String(v)}"`);
      return `<${tag} ${pairs.join(" ")}/>`;
    })
    .join("");
  return `<svg width="${size}" height="${size}" ${SVG_ATTRS}>${children}</svg>`;
}
