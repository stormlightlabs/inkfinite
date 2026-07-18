import "fake-indexeddb/auto";
import { InkfiniteDB } from "$lib/persistence/database";
import { createDexieDocRepo } from "$lib/persistence/repository";
import {
  type BoardExport,
  DeleteShapesCommand,
  type DesktopFileData,
  type EditorState,
  hitTestPoint,
  parseDesktopFile,
  type ShapeRecord as Shape,
  stencils,
  Store,
  UpdateShapeCommand,
  validateDoc,
} from "@inkfinite/core";
import Dexie from "dexie";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const openDatabases: Dexie[] = [];

function readFixture<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/v1", relativePath), "utf8")) as T;
}

afterEach(async () => {
  await Promise.all(openDatabases.map((database) => database.delete()));
  openDatabases.length = 0;
});

describe("frozen v1 compatibility fixtures", () => {
  it("covers every shape kind, pages, bindings, groups, Markdown, stencils, and persisted order", () => {
    const fixture = readFixture<DesktopFileData>("desktop/all-features.inkfinite.json");
    const manifest = readFixture<
      { coverage: { shapeTypes: string[]; stencilIds: string[]; groupIds: string[]; bindingIds: string[] } }
    >("manifest.json");

    expect(validateDoc(fixture.doc)).toEqual({ ok: true });
    expect([...new Set(Object.values(fixture.doc.shapes).map((shape) => shape.type))].sort()).toEqual(
      [...manifest.coverage.shapeTypes].sort(),
    );
    expect([...new Set(Object.values(fixture.doc.shapes).flatMap((shape) => shape.groupId ?? []))].sort()).toEqual(
      [...manifest.coverage.groupIds].sort(),
    );
    expect(Object.keys(fixture.doc.bindings).sort()).toEqual([...manifest.coverage.bindingIds].sort());
    expect(Object.values(fixture.doc.shapes).find((shape) => shape.type === "markdown")?.props).toMatchObject({
      md: expect.stringContaining("Frozen Markdown"),
      w: 360,
      h: 240,
    });
    expect(fixture.order.pageIds).toEqual(["page:ordering", "page:fixtures"]);
    for (const page of Object.values(fixture.doc.pages)) {
      expect(fixture.order.shapeOrder?.[page.id]).toEqual(page.shapeIds);
    }

    stencils.registerBuiltinStencils();
    const builtInStencilIds = new Set(stencils.registry.getAll().map((stencil) => stencil.id));
    expect(manifest.coverage.stencilIds.every((id) => builtInStencilIds.has(id))).toBe(true);
    expect(stencils.registry.get("ui:card")?.spawn({ x: 20, y: 30 }).map((shape) => shape.type)).toEqual([
      "rect",
      "line",
    ]);
  });

  it("imports and exports the complete web fixture without semantic or ordering drift", async () => {
    const fixture = readFixture<BoardExport>("web/all-features.web.json");
    const database = new InkfiniteDB(`v1-fixture-${crypto.randomUUID()}`);
    openDatabases.push(database);
    const repo = createDexieDocRepo(database);

    const boardId = await repo.importBoard(fixture);
    await repo.openBoard(boardId);
    const exported = await repo.exportBoard(boardId);

    expect(exported.doc).toEqual(fixture.doc);
    expect(exported.order).toEqual(fixture.order);
    expect(exported.board).toMatchObject({ id: fixture.board.id, name: fixture.board.name });
  });

  it("opens and serializes the desktop fixture without losing document order", () => {
    const source = readFileSync(resolve(repositoryRoot, "fixtures/v1/desktop/all-features.inkfinite.json"), "utf8");
    const parsed = parseDesktopFile(source);
    const reopened = parseDesktopFile(JSON.stringify(parsed, null, 2));

    expect(reopened).toEqual(parsed);
    expect(reopened.order.shapeOrder).toEqual(
      Object.fromEntries(Object.values(reopened.doc.pages).map((page) => [page.id, page.shapeIds])),
    );
  });

  it("keeps invalid fixtures invalid instead of repairing them into the baseline", () => {
    const malformed = readFileSync(
      resolve(repositoryRoot, "fixtures/v1/invalid/malformed-json.inkfinite.json"),
      "utf8",
    );
    expect(() => parseDesktopFile(malformed)).toThrow(SyntaxError);

    const missingFields = readFileSync(
      resolve(repositoryRoot, "fixtures/v1/invalid/missing-envelope-fields.json"),
      "utf8",
    );
    expect(() => parseDesktopFile(missingFields)).toThrow("missing required fields");

    for (const fixtureName of ["dangling-references.inkfinite.json", "duplicate-order.inkfinite.json"]) {
      const fixture = readFixture<DesktopFileData>(`invalid/${fixtureName}`);
      const result = validateDoc(fixture.doc);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("preserves hit-test priority from persisted shape ordering", () => {
    const fixture = readFixture<DesktopFileData>("desktop/all-features.inkfinite.json");
    const state: EditorState = {
      doc: fixture.doc,
      ui: { currentPageId: "page:ordering", selectionIds: [], toolId: "select" },
      camera: { x: 0, y: 0, zoom: 1 },
    };

    expect(hitTestPoint(state, { x: 190, y: 190 })).toBe("shape:ordering-front");
    expect(hitTestPoint(state, { x: 159, y: 159 })).toBe("shape:ordering-middle");
    expect(hitTestPoint(state, { x: 110, y: 110 })).toBe("shape:ordering-back");
    expect(hitTestPoint(state, { x: 500, y: 500 })).toBeNull();
  });

  it("replays and undoes the frozen history-relevant edits", () => {
    const fixture = readFixture<
      {
        initialState: EditorState;
        edits: Array<{ kind: string; shapeId: string; patch?: Partial<Shape> & { props?: Record<string, unknown> } }>;
        expectedAfterUndoAll: { shapeId: string; x: number; y: number; fill: string };
      }
    >("history/history-edits.json");
    const store = new Store(fixture.initialState);

    for (const edit of fixture.edits) {
      const current = store.getState().doc.shapes[edit.shapeId];
      expect(current).toBeDefined();
      if (edit.kind === "delete-shape") {
        store.executeCommand(new DeleteShapesCommand([current], current.pageId));
        continue;
      }
      const patch = edit.patch ?? {};
      const next = { ...current, ...patch, props: { ...current.props, ...(patch.props ?? {}) } } as Shape;
      store.executeCommand(new UpdateShapeCommand(current.id, current, next));
    }

    expect(store.getState().doc.shapes[fixture.expectedAfterUndoAll.shapeId]).toBeUndefined();
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);

    const restored = store.getState().doc.shapes[fixture.expectedAfterUndoAll.shapeId];
    expect(restored).toMatchObject({ x: fixture.expectedAfterUndoAll.x, y: fixture.expectedAfterUndoAll.y });
    expect(restored.type === "rect" ? restored.props.fill : undefined).toBe(fixture.expectedAfterUndoAll.fill);
  });
});
