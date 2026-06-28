// ---------------------------------------------------------------------------
// GpxUpload component test (M3 key component tests)
// Focus: the .gpx filtering / disabled guard in the drop + change handlers.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GpxUpload } from "../components/GpxUpload";

afterEach(cleanup);

function gpx(name: string): File {
  return new File(["<gpx></gpx>"], name, { type: "application/gpx+xml" });
}

describe("GpxUpload", () => {
  it("passes only .gpx files to onFiles on drop", () => {
    const onFiles = vi.fn();
    const { container } = render(<GpxUpload onFiles={onFiles} />);
    const zone = container.querySelector(".upload-zone") as HTMLElement;

    fireEvent.drop(zone, {
      dataTransfer: { files: [gpx("route.gpx"), new File(["x"], "notes.txt")] },
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    const passed: File[] = onFiles.mock.calls[0][0];
    expect(passed.map((f) => f.name)).toEqual(["route.gpx"]);
  });

  it("does not call onFiles when a non-.gpx file is dropped", () => {
    const onFiles = vi.fn();
    const { container } = render(<GpxUpload onFiles={onFiles} />);
    const zone = container.querySelector(".upload-zone") as HTMLElement;

    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "notes.txt")] } });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("ignores drops while disabled", () => {
    const onFiles = vi.fn();
    const { container } = render(<GpxUpload onFiles={onFiles} disabled />);
    const zone = container.querySelector(".upload-zone") as HTMLElement;

    fireEvent.drop(zone, { dataTransfer: { files: [gpx("route.gpx")] } });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("forwards picked files via the file input", () => {
    const onFiles = vi.fn();
    render(<GpxUpload onFiles={onFiles} />);
    const input = screen.getByLabelText("Upload GPX files") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [gpx("a.gpx"), gpx("b.gpx")] } });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toHaveLength(2);
  });
});
