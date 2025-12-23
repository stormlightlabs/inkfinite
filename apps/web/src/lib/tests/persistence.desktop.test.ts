import {
  type BoardMeta,
  createFileData,
  type DesktopFileOps,
  type FileHandle,
  PageRecord,
  serializeDesktopFile,
} from "inkfinite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDesktopDocRepo } from "../persistence/desktop";

function createFakeFileOps() {
  const files = new Map<string, string>();
  const recent: FileHandle[] = [];
  let nextOpen: string | null = null;
  let nextSave: string | null = null;

  const ops: DesktopFileOps = {
    async showOpenDialog() {
      const value = nextOpen;
      nextOpen = null;
      return value;
    },
    async showSaveDialog(defaultName) {
      const value = nextSave ?? `/tmp/${defaultName ?? "untitled"}`;
      nextSave = null;
      return value;
    },
    async readFile(path) {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`Missing file: ${path}`);
      }
      return content;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
    async getRecentFiles() {
      return [...recent];
    },
    async addRecentFile(handle) {
      const filtered = recent.filter((entry) => entry.path !== handle.path);
      recent.splice(0, recent.length, handle, ...filtered);
    },
    async removeRecentFile(path) {
      const index = recent.findIndex((entry) => entry.path === path);
      if (index >= 0) {
        recent.splice(index, 1);
      }
    },
    async clearRecentFiles() {
      recent.splice(0, recent.length);
    },
  };

  return {
    ops,
    files,
    recent,
    setNextOpen(path: string | null) {
      nextOpen = path;
    },
    setNextSave(path: string | null) {
      nextSave = path;
    },
  };
}

describe("createDesktopDocRepo", () => {
  const fake = createFakeFileOps();

  beforeEach(() => {
    fake.files.clear();
    fake.recent.splice(0, fake.recent.length);
    fake.setNextOpen(null);
    fake.setNextSave(null);
  });

  it("creates a board and lists it via recent files", async () => {
    const repo = createDesktopDocRepo(fake.ops);
    fake.setNextSave("/tmp/board-one.inkfinite.json");
    const boardId = await repo.createBoard("Board One");

    const boards = await repo.listBoards();
    expect(boards).toHaveLength(1);
    expect(boards[0].id).toBe(boardId);
    expect(boards[0].name).toBe("Board One");

    const loaded = await repo.loadDoc(boardId);
    expect(Object.keys(loaded.pages)).toHaveLength(1);
  });

  it("opens an existing file via dialog", async () => {
    const repo = createDesktopDocRepo(fake.ops);
    const page = PageRecord.create("Dialog Page");
    const board = { id: "board-dialog", name: "Dialog Board", createdAt: Date.now(), updatedAt: Date.now() };
    const fileData = createFileData(board, { [page.id]: page }, {}, {}, {
      pageIds: [page.id],
      shapeOrder: { [page.id]: [] },
    });
    const path = "/tmp/dialog-board.inkfinite.json";
    fake.files.set(path, serializeDesktopFile(fileData));
    fake.setNextOpen(path);

    const opened = await repo.openFromDialog();
    expect(opened.boardId).toBe("board-dialog");
    expect(Object.keys(opened.doc.pages)).toEqual([page.id]);

    const boards = await repo.listBoards();
    expect(boards.some((entry: BoardMeta) => entry.id === "board-dialog")).toBe(true);
  });

  it("renames the current board and updates the file", async () => {
    const repo = createDesktopDocRepo(fake.ops);
    fake.setNextSave("/tmp/rename-board.inkfinite.json");
    const boardId = await repo.createBoard("Old Name");
    await repo.renameBoard(boardId, "New Name");

    const stored = fake.files.get("/tmp/rename-board.inkfinite.json");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(String(stored));
    expect(parsed.board.name).toBe("New Name");
  });

  it("prunes missing recents when listing boards", async () => {
    const repo = createDesktopDocRepo(fake.ops);
    fake.recent.push({ path: "/tmp/missing.inkfinite.json", name: "Missing" });
    const boards = await repo.listBoards();
    expect(boards).toHaveLength(0);
    expect(fake.recent).toHaveLength(0);
  });
});
