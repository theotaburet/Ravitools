// GpxUpload component test
// Focus: the .gpx filtering / disabled guard in the drop + change handlers.
// The processFiles action atom is mocked so the real pipeline never runs.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { atom, createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onFiles = vi.fn();

vi.mock("../state/route", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../state/route")>();
  return {
    ...orig,
    processFilesAtom: atom(null, (_get, _set, files: File[], append?: boolean) =>
      onFiles(files, append),
    ),
  };
});

import { GpxUpload } from "../components/GpxUpload";
import { serializeSession } from "../lib/session";
import { routeErrorAtom, stageAtom } from "../state/route";

afterEach(cleanup);
beforeEach(() => onFiles.mockReset());

function gpx(name: string): File {
  return new File(["<gpx></gpx>"], name, { type: "application/gpx+xml" });
}

function renderUpload(processing = false) {
  const store = createStore();
  if (processing) store.set(stageAtom, "querying");
  const view = render(
    <Provider store={store}>
      <GpxUpload />
    </Provider>,
  );
  return { ...view, store };
}

describe("GpxUpload", () => {
  it("passes only .gpx files to processFiles on drop", () => {
    const { container } = renderUpload();
    const zone = container.querySelector(".upload-zone") as HTMLElement;

    fireEvent.drop(zone, {
      dataTransfer: { files: [gpx("route.gpx"), new File(["x"], "notes.txt")] },
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    const passed: File[] = onFiles.mock.calls[0][0];
    expect(passed.map((f) => f.name)).toEqual(["route.gpx"]);
  });

  // A .fit or .tcx dropped (or picked on Android, where accept is a hint) must not do nothing
  it("says so when no dropped file can be loaded", () => {
    const { container, store } = renderUpload();
    const zone = container.querySelector(".upload-zone") as HTMLElement;

    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "ride.fit")] } });

    expect(onFiles).not.toHaveBeenCalled();
    expect(store.get(routeErrorAtom)).toMatch(/\.gpx/);
  });

  it("ignores drops while the pipeline is processing", () => {
    const { container } = renderUpload(true);
    const zone = container.querySelector(".upload-zone") as HTMLElement;

    fireEvent.drop(zone, { dataTransfer: { files: [gpx("route.gpx")] } });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("forwards picked files via the file input", () => {
    renderUpload();
    const input = screen.getByLabelText("Upload GPX files") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [gpx("a.gpx"), gpx("b.gpx")] } });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toHaveLength(2);
  });

  it("adds the picked files to the loaded traces with append", () => {
    render(
      <Provider store={createStore()}>
        <GpxUpload append />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText("Add a GPX"), { target: { files: [gpx("b.gpx")] } });
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: "b.gpx" })], true);
  });

  it("imports a .ravitools.json plan instead of running the pipeline", async () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <GpxUpload />
      </Provider>,
    );
    const zone = container.querySelector(".upload-zone") as HTMLElement;
    const plan = new File(
      [
        serializeSession({
          activeCategories: new Set(),
          traces: [
            {
              id: "trace_1",
              original: [
                { lat: 47.0, lon: 0.6 },
                { lat: 47.1, lon: 0.7 },
              ],
              simplified: [{ lat: 47.0, lon: 0.6 }],
              totalDistanceM: 12345,
              elevationGainM: 500,
              elevationLossM: 300,
              name: "Test Route",
              color: "#1a1a1a",
            },
          ],
          pois: [],
          enrichments: new Map(),
          enrichAll: false,
          routeSettings: { maxDistanceM: 1500 },
        }),
      ],
      "plan.ravitools.json",
    );

    fireEvent.drop(zone, { dataTransfer: { files: [plan] } });

    await vi.waitFor(() => expect(store.get(stageAtom)).toBe("done"));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("shows an error for a corrupt plan file", async () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <GpxUpload />
      </Provider>,
    );
    const zone = container.querySelector(".upload-zone") as HTMLElement;

    fireEvent.drop(zone, { dataTransfer: { files: [new File(["nope{{{"], "bad.json")] } });

    await vi.waitFor(() => expect(store.get(routeErrorAtom)).toBeTruthy());
    expect(onFiles).not.toHaveBeenCalled();
  });
});
