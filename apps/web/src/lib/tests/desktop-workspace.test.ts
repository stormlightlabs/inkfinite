/**
 * Unit tests for desktop workspace functionality
 */

import { createDesktopDocRepo } from "$lib/persistence/desktop";
import type { DesktopFileOps, DirectoryEntry } from "inkfinite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Desktop workspace mode", () => {
  let fileOps: DesktopFileOps;
  let mockWorkspaceDir: string | null;
  let mockFiles: Map<string, string>;
  let mockDirectoryEntries: DirectoryEntry[];

  beforeEach(() => {
    mockWorkspaceDir = null;
    mockFiles = new Map();
    mockDirectoryEntries = [];

    fileOps = {
      showOpenDialog: vi.fn(async () => "/test/path.inkfinite.json"),
      showSaveDialog: vi.fn(async (defaultName?: string) => `/test/${defaultName || "file.inkfinite.json"}`),
      readFile: vi.fn(async (path: string) => {
        const content = mockFiles.get(path);
        if (!content) throw new Error(`File not found: ${path}`);
        return content;
      }),
      writeFile: vi.fn(async (path: string, content: string) => {
        mockFiles.set(path, content);
      }),
      getRecentFiles: vi.fn(async () => []),
      addRecentFile: vi.fn(async () => {}),
      removeRecentFile: vi.fn(async () => {}),
      clearRecentFiles: vi.fn(async () => {}),
      getWorkspaceDir: vi.fn(async () => mockWorkspaceDir),
      setWorkspaceDir: vi.fn(async (path: string | null) => {
        mockWorkspaceDir = path;
      }),
      pickWorkspaceDir: vi.fn(async () => {
        mockWorkspaceDir = "/test/workspace";
        return mockWorkspaceDir;
      }),
      readDirectory: vi.fn(async (_directory: string, _pattern?: string) => {
        return mockDirectoryEntries;
      }),
      renameFile: vi.fn(async (oldPath: string, newPath: string) => {
        const content = mockFiles.get(oldPath);
        if (!content) throw new Error(`File not found: ${oldPath}`);
        mockFiles.set(newPath, content);
        mockFiles.delete(oldPath);
      }),
      deleteFile: vi.fn(async (path: string) => {
        if (!mockFiles.has(path)) throw new Error(`File not found: ${path}`);
        mockFiles.delete(path);
      }),
    };
  });

  describe("Workspace directory management", () => {
    it("should get workspace directory", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = "/test/workspace";
      const dir = await repo.getWorkspaceDir();
      expect(dir).toBe("/test/workspace");
    });

    it("should set workspace directory", async () => {
      const repo = createDesktopDocRepo(fileOps);
      await repo.setWorkspaceDir("/new/workspace");
      expect(mockWorkspaceDir).toBe("/new/workspace");
    });

    it("should clear workspace directory", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = "/test/workspace";
      await repo.setWorkspaceDir(null);
      expect(mockWorkspaceDir).toBeNull();
    });

    it("should pick workspace directory", async () => {
      const repo = createDesktopDocRepo(fileOps);
      const dir = await repo.pickWorkspaceDir();
      expect(dir).toBe("/test/workspace");
      expect(mockWorkspaceDir).toBe("/test/workspace");
    });
  });

  describe("listBoards with workspace mode", () => {
    it("should list boards from workspace directory", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = "/workspace";

      const board1Content = JSON.stringify({
        board: { id: "board-1", name: "Board 1", createdAt: 1000, updatedAt: 2000 },
        doc: { pages: {}, shapes: {}, bindings: {} },
        order: { pageIds: [], shapeOrder: {} },
      });

      const board2Content = JSON.stringify({
        board: { id: "board-2", name: "Board 2", createdAt: 1500, updatedAt: 2500 },
        doc: { pages: {}, shapes: {}, bindings: {} },
        order: { pageIds: [], shapeOrder: {} },
      });

      mockFiles.set("/workspace/board1.inkfinite.json", board1Content);
      mockFiles.set("/workspace/board2.inkfinite.json", board2Content);

      mockDirectoryEntries = [
        { path: "/workspace/board1.inkfinite.json", name: "board1.inkfinite.json", isDir: false },
        { path: "/workspace/board2.inkfinite.json", name: "board2.inkfinite.json", isDir: false },
      ];

      const boards = await repo.listBoards();

      expect(boards).toHaveLength(2);
      expect(boards[0].name).toBe("Board 2"); // Sorted by updatedAt descending
      expect(boards[1].name).toBe("Board 1");
    });

    it("should skip directories when listing workspace", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = "/workspace";

      const boardContent = JSON.stringify({
        board: { id: "board-1", name: "Board 1", createdAt: 1000, updatedAt: 2000 },
        doc: { pages: {}, shapes: {}, bindings: {} },
        order: { pageIds: [], shapeOrder: {} },
      });

      mockFiles.set("/workspace/board.inkfinite.json", boardContent);

      mockDirectoryEntries = [{ path: "/workspace/board.inkfinite.json", name: "board.inkfinite.json", isDir: false }, {
        path: "/workspace/subfolder",
        name: "subfolder",
        isDir: true,
      }];

      const boards = await repo.listBoards();

      expect(boards).toHaveLength(1);
      expect(boards[0].name).toBe("Board 1");
    });

    it("should fall back to recent files when no workspace set", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = null;

      const boardContent = JSON.stringify({
        board: { id: "board-1", name: "Recent Board", createdAt: 1000, updatedAt: 2000 },
        doc: { pages: {}, shapes: {}, bindings: {} },
        order: { pageIds: [], shapeOrder: {} },
      });

      mockFiles.set("/recent/board.inkfinite.json", boardContent);

      fileOps.getRecentFiles = vi.fn(
        async () => [{ path: "/recent/board.inkfinite.json", name: "board.inkfinite.json" }]
      );

      const boards = await repo.listBoards();

      expect(boards).toHaveLength(1);
      expect(boards[0].name).toBe("Recent Board");
    });
  });

  describe("createBoard with workspace mode", () => {
    it("should save new board in workspace directory", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = "/workspace";

      const boardId = await repo.createBoard("Test Board");

      expect(boardId).toBeTruthy();
      expect(mockFiles.has("/workspace/Test Board.inkfinite.json")).toBe(true);

      const fileContent = mockFiles.get("/workspace/Test Board.inkfinite.json")!;
      const data = JSON.parse(fileContent);
      expect(data.board.name).toBe("Test Board");
    });

    it("should show save dialog when no workspace set", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = null;

      await repo.createBoard("Test Board");

      expect(fileOps.showSaveDialog).toHaveBeenCalledWith("Test Board.inkfinite.json");
    });
  });

  describe("renameBoard with workspace mode", () => {
    it("should rename file and update content in workspace mode", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = "/workspace";

      const originalPath = "/workspace/Original.inkfinite.json";
      const boardContent = JSON.stringify({
        board: { id: "board-1", name: "Original", createdAt: 1000, updatedAt: 2000 },
        doc: { pages: { "page-1": { id: "page-1", name: "Page 1", shapeIds: [] } }, shapes: {}, bindings: {} },
        order: { pageIds: ["page-1"], shapeOrder: { "page-1": [] } },
      });

      mockFiles.set(originalPath, boardContent);
      mockDirectoryEntries = [{ path: originalPath, name: "Original.inkfinite.json", isDir: false }];

      // List boards first to populate boardFiles map
      await repo.listBoards();
      await repo.openBoard("board-1");
      await repo.renameBoard("board-1", "Renamed");

      const newPath = "/workspace/Renamed.inkfinite.json";
      expect(mockFiles.has(newPath)).toBe(true);

      const newContent = mockFiles.get(newPath)!;
      const data = JSON.parse(newContent);
      expect(data.board.name).toBe("Renamed");
    });

    it("should update content only in recent files mode", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = null;

      const path = "/recent/board.inkfinite.json";
      const boardContent = JSON.stringify({
        board: { id: "board-1", name: "Original", createdAt: 1000, updatedAt: 2000 },
        doc: { pages: { "page-1": { id: "page-1", name: "Page 1", shapeIds: [] } }, shapes: {}, bindings: {} },
        order: { pageIds: ["page-1"], shapeOrder: { "page-1": [] } },
      });

      mockFiles.set(path, boardContent);
      fileOps.getRecentFiles = vi.fn(async () => [{ path, name: "board.inkfinite.json" }]);

      // List boards first to populate boardFiles map
      await repo.listBoards();
      await repo.openBoard("board-1");
      await repo.renameBoard("board-1", "Renamed");

      // File path should not change in recent files mode
      expect(mockFiles.has(path)).toBe(true);

      const newContent = mockFiles.get(path)!;
      const data = JSON.parse(newContent);
      expect(data.board.name).toBe("Renamed");
    });
  });

  describe("deleteBoard with workspace mode", () => {
    it("should delete file in workspace mode", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = "/workspace";

      const path = "/workspace/board.inkfinite.json";
      const boardContent = JSON.stringify({
        board: { id: "board-1", name: "Board", createdAt: 1000, updatedAt: 2000 },
        doc: { pages: {}, shapes: {}, bindings: {} },
        order: { pageIds: [], shapeOrder: {} },
      });

      mockFiles.set(path, boardContent);
      mockDirectoryEntries = [{ path, name: "board.inkfinite.json", isDir: false }];

      const boards = await repo.listBoards();
      expect(boards).toHaveLength(1);

      await repo.deleteBoard("board-1");

      expect(mockFiles.has(path)).toBe(false);
      expect(fileOps.deleteFile).toHaveBeenCalledWith(path);
    });

    it("should remove from recent files in non-workspace mode", async () => {
      const repo = createDesktopDocRepo(fileOps);
      mockWorkspaceDir = null;

      const path = "/recent/board.inkfinite.json";
      const boardContent = JSON.stringify({
        board: { id: "board-1", name: "Board", createdAt: 1000, updatedAt: 2000 },
        doc: { pages: {}, shapes: {}, bindings: {} },
        order: { pageIds: [], shapeOrder: {} },
      });

      mockFiles.set(path, boardContent);
      fileOps.getRecentFiles = vi.fn(async () => [{ path, name: "board.inkfinite.json" }]);

      const boards = await repo.listBoards();
      expect(boards).toHaveLength(1);

      await repo.deleteBoard("board-1");

      expect(fileOps.removeRecentFile).toHaveBeenCalledWith(path);
      expect(fileOps.deleteFile).not.toHaveBeenCalled();
    });
  });
});
