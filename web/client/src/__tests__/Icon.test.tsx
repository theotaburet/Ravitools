// --- Icon: the same lucide drawing as a React element and as markup ---

import { render } from "@testing-library/react";
import { Droplet } from "lucide";
import { describe, expect, it } from "vitest";
import { Icon, iconSvg } from "../components/Icon";

describe("Icon", () => {
  it("draws the same paths as React and as an SVG string", () => {
    const { container } = render(<Icon node={Droplet} />);
    const markup = new DOMParser().parseFromString(iconSvg(Droplet), "image/svg+xml");

    const reactPaths = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    const stringPaths = [...markup.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    expect(reactPaths.length).toBeGreaterThan(0);
    expect(stringPaths).toEqual(reactPaths);
    expect(markup.documentElement.getAttribute("stroke")).toBe("currentColor");
  });
});
