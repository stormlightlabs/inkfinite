/**
 * Desktop (Tauri) file-based DocRepo implementation
 * Used when the web app is running inside Tauri
 */

import type { BoardExport, BoardMeta, DocPatch, DocRepo, LoadedDoc, PageRecord } from "inkfinite-core";
import {
  createFileData,
  createId,
  type DesktopFileData,
  type FileHandle,
  loadedDocFromFileData,
  parseDesktopFile,
  serializeDesktopFile,
} from "inkfinite-core";
import type { DesktopFileOps } from "../fileops";

export type DesktopDocRepo = DocRepo & {
  kind: "desktop";
  getCurrentFile(): FileHandle | null;
  openFromDialog(): Promise<{ boardId: string; doc: LoadedDoc }>;
};

export function isDesktopRepo(repo: DocRepo): repo is DesktopDocRepo {
  return (repo as DesktopDocRepo).kind === "desktop";
}

/**
 * Create a desktop file-based DocRepo
 * This implementation manages a single document loaded from disk
 */
export function createDesktopDocRepo(fileOps: DesktopFileOps): DesktopDocRepo {
  let currentFile: FileHandle | null = null;
  let currentBoard: BoardMeta | null = null;
  let currentDoc: LoadedDoc | null = null;
  const boardFiles = new Map<string, FileHandle>();

  type StoredHandle = { path: string; name?: string };

  function setCurrentState(file: FileHandle, board: BoardMeta, doc: LoadedDoc) {
    currentFile = file;
    currentBoard = board;
    currentDoc = doc;
    boardFiles.set(board.id, file);
  }

  async function loadFromHandle(handle: StoredHandle): Promise<LoadedDoc> {
    const content = await fileOps.readFile(handle.path);
    const fileData = parseDesktopFile(content);
    const doc = loadedDocFromFileData(fileData);
    const normalizedHandle: FileHandle = {
      path: handle.path,
      name: handle.name ?? handle.path.split("/").pop() ?? "Untitled",
    };
    setCurrentState(normalizedHandle, fileData.board, doc);
    await fileOps.addRecentFile(normalizedHandle);
    return doc;
  }

  async function loadFromPath(path: string): Promise<LoadedDoc> {
    const handle: FileHandle = { path, name: path.split("/").pop() || "Untitled" };
    return loadFromHandle(handle);
  }

  async function listBoards(): Promise<BoardMeta[]> {
    const recent = await fileOps.getRecentFiles();
    const boards: BoardMeta[] = [];

    for (const handle of recent) {
      try {
        const content = await fileOps.readFile(handle.path);
        const fileData = parseDesktopFile(content);
        boards.push(fileData.board);
        boardFiles.set(fileData.board.id, handle);
      } catch {
        await fileOps.removeRecentFile(handle.path);
      }
    }

    return boards.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function createDefaultPage(name: string): PageRecord {
    return { id: createId("page"), name, shapeIds: [] };
  }

  async function createBoard(name: string): Promise<string> {
    const boardId = createId("board");
    const timestamp = Date.now();
    const page = createDefaultPage("Page 1");

    const board: BoardMeta = {
      id: boardId,
      name: name || "Untitled Board",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const fileData = createFileData(board, { [page.id]: page }, {}, {}, {
      pageIds: [page.id],
      shapeOrder: { [page.id]: [] },
    });

    const path = await fileOps.showSaveDialog(`${name || "Untitled"}.inkfinite.json`);
    if (!path) {
      throw new Error("Save cancelled");
    }

    await fileOps.writeFile(path, serializeDesktopFile(fileData));

    const handle = { path, name: path.split("/").pop() || name };
    setCurrentState(handle, board, loadedDocFromFileData(fileData));

    await fileOps.addRecentFile(handle);
    return boardId;
  }

  async function renameBoard(boardId: string, name: string): Promise<void> {
    if (!currentBoard || currentBoard.id !== boardId) {
      await loadDoc(boardId);
    }
    if (!currentBoard || !currentDoc || !currentFile) {
      throw new Error("No board loaded");
    }

    currentBoard = { ...currentBoard, name, updatedAt: Date.now() };

    const fileData = createFileData(
      currentBoard,
      currentDoc.pages,
      currentDoc.shapes,
      currentDoc.bindings,
      currentDoc.order,
    );

    await fileOps.writeFile(currentFile.path, serializeDesktopFile(fileData));
    boardFiles.set(currentBoard.id, currentFile);
  }

  async function deleteBoard(boardId: string): Promise<void> {
    const handle = boardFiles.get(boardId);
    if (handle) {
      await fileOps.removeRecentFile(handle.path);
      boardFiles.delete(boardId);
    }
    if (currentBoard?.id === boardId) {
      currentFile = null;
      currentBoard = null;
      currentDoc = null;
    }
  }

  async function loadDoc(boardId: string): Promise<LoadedDoc> {
    if (currentDoc && currentBoard?.id === boardId) {
      return currentDoc;
    }
    const handle = boardFiles.get(boardId);
    if (!handle) {
      throw new Error(`Unknown board: ${boardId}`);
    }
    try {
      return await loadFromHandle(handle);
    } catch (error) {
      await fileOps.removeRecentFile(handle.path);
      boardFiles.delete(boardId);
      throw error;
    }
  }

  async function applyDocPatch(boardId: string, patch: DocPatch): Promise<void> {
    if (!currentBoard || !currentDoc || !currentFile) {
      throw new Error("No board loaded");
    }

    if (patch.deletes) {
      if (patch.deletes.pageIds) {
        for (const id of patch.deletes.pageIds) {
          delete currentDoc.pages[id];
        }
      }
      if (patch.deletes.shapeIds) {
        for (const id of patch.deletes.shapeIds) {
          delete currentDoc.shapes[id];
        }
      }
      if (patch.deletes.bindingIds) {
        for (const id of patch.deletes.bindingIds) {
          delete currentDoc.bindings[id];
        }
      }
    }

    if (patch.upserts) {
      if (patch.upserts.pages) {
        for (const page of patch.upserts.pages) {
          currentDoc.pages[page.id] = page;
        }
      }
      if (patch.upserts.shapes) {
        for (const shape of patch.upserts.shapes) {
          currentDoc.shapes[shape.id] = shape;
        }
      }
      if (patch.upserts.bindings) {
        for (const binding of patch.upserts.bindings) {
          currentDoc.bindings[binding.id] = binding;
        }
      }
    }

    if (patch.order) {
      if (patch.order.pageIds) {
        currentDoc.order.pageIds = patch.order.pageIds;
      }
      if (patch.order.shapeOrder) {
        currentDoc.order.shapeOrder = patch.order.shapeOrder;
      }
    }

    currentBoard = { ...currentBoard, updatedAt: Date.now() };

    const fileData = createFileData(
      currentBoard,
      currentDoc.pages,
      currentDoc.shapes,
      currentDoc.bindings,
      currentDoc.order,
    );

    await fileOps.writeFile(currentFile.path, serializeDesktopFile(fileData));
    boardFiles.set(currentBoard.id, currentFile);
  }

  async function exportBoard(_boardId: string): Promise<BoardExport> {
    if (!currentBoard || !currentDoc) {
      throw new Error("No board loaded");
    }

    return {
      board: currentBoard,
      doc: { pages: currentDoc.pages, shapes: currentDoc.shapes, bindings: currentDoc.bindings },
      order: currentDoc.order,
    };
  }

  async function importBoard(snapshot: BoardExport): Promise<string> {
    const boardId = snapshot.board.id ?? createId("board");
    const timestamp = Date.now();

    const board: BoardMeta = {
      id: boardId,
      name: snapshot.board.name || "Imported Board",
      createdAt: snapshot.board.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    const fileData: DesktopFileData = { board, doc: snapshot.doc, order: snapshot.order };

    const path = await fileOps.showSaveDialog(`${board.name}.inkfinite.json`);
    if (!path) {
      throw new Error("Save cancelled");
    }

    await fileOps.writeFile(path, serializeDesktopFile(fileData));

    const handle = { path, name: path.split("/").pop() || board.name };
    setCurrentState(handle, board, loadedDocFromFileData(fileData));

    await fileOps.addRecentFile(handle);

    return boardId;
  }

  async function openFromDialog(): Promise<{ boardId: string; doc: LoadedDoc }> {
    const path = await fileOps.showOpenDialog();
    if (!path) {
      throw new Error("Open cancelled");
    }
    const doc = await loadFromPath(path);
    if (!currentBoard) {
      throw new Error("Failed to open file");
    }
    return { boardId: currentBoard.id, doc };
  }

  return {
    kind: "desktop",
    listBoards,
    createBoard,
    renameBoard,
    deleteBoard,
    loadDoc,
    applyDocPatch,
    exportBoard,
    importBoard,
    getCurrentFile: () => currentFile,
    openFromDialog,
  };
}

/**
 * Get current file handle (for showing in title bar, etc.)
 */
export function getCurrentFile(repo: DocRepo): FileHandle | null {
  if (isDesktopRepo(repo)) {
    return repo.getCurrentFile();
  }
  return null;
}
