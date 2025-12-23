/**
 * Desktop (Tauri) file-based DocRepo implementation
 * Used when the web app is running inside Tauri
 */

import type { BoardExport, BoardMeta, DocPatch, DocRepo, LoadedDoc } from "inkfinite-core";
import {
  createFileData,
  createId,
  type DesktopFileData,
  type FileHandle,
  loadedDocFromFileData,
  PageRecord,
  parseDesktopFile,
  serializeDesktopFile,
} from "inkfinite-core";
import type { DesktopFileOps } from "../fileops";

/**
 * Create a desktop file-based DocRepo
 * This implementation manages a single document loaded from disk
 */
export function createDesktopDocRepo(fileOps: DesktopFileOps): DocRepo {
  let currentFile: FileHandle | null = null;
  let currentBoard: BoardMeta | null = null;
  let currentDoc: LoadedDoc | null = null;

  async function listBoards(): Promise<BoardMeta[]> {
    // TODO: cache metadata or read it from files
    // const recent = await fileOps.getRecentFiles();
    return [];
  }

  async function createBoard(name: string): Promise<string> {
    const boardId = createId("board");
    const timestamp = Date.now();
    const page = PageRecord.create("Page 1");

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

    currentFile = { path, name: path.split("/").pop() || name };
    currentBoard = board;
    currentDoc = loadedDocFromFileData(fileData);

    await fileOps.addRecentFile(currentFile);
    return boardId;
  }

  async function renameBoard(boardId: string, name: string): Promise<void> {
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
  }

  async function deleteBoard(_boardId: string): Promise<void> {
    if (currentFile) {
      await fileOps.removeRecentFile(currentFile.path);
      currentFile = null;
      currentBoard = null;
      currentDoc = null;
    }
  }

  async function loadDoc(boardId: string): Promise<LoadedDoc> {
    if (currentDoc && currentBoard?.id === boardId) {
      return currentDoc;
    }

    const path = await fileOps.showOpenDialog();
    if (!path) {
      throw new Error("Open cancelled");
    }

    const content = await fileOps.readFile(path);
    const fileData = parseDesktopFile(content);

    currentFile = { path, name: path.split("/").pop() || "Untitled" };
    currentBoard = fileData.board;
    currentDoc = loadedDocFromFileData(fileData);

    await fileOps.addRecentFile(currentFile);

    return currentDoc;
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

    currentFile = { path, name: path.split("/").pop() || board.name };
    currentBoard = board;
    currentDoc = loadedDocFromFileData(fileData);

    await fileOps.addRecentFile(currentFile);

    return boardId;
  }

  return { listBoards, createBoard, renameBoard, deleteBoard, loadDoc, applyDocPatch, exportBoard, importBoard };
}

/**
 * Get current file handle (for showing in title bar, etc.)
 */
export function getCurrentFile(_repo: unknown): FileHandle | null {
  // TODO: expose this properly
  return null;
}
