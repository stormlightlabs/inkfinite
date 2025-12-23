import type { BindingRecord, Document, PageRecord, ShapeRecord } from "../model";
import type { BoardMeta } from "../persist/DocRepo";
import type { DocOrder, LoadedDoc } from "./web";

/**
 * Desktop file representation - combines board metadata with document content
 */
export type DesktopFileData = { board: BoardMeta; doc: Document; order: DocOrder };

/**
 * File handle for desktop - just the path
 */
export type FileHandle = { path: string; name: string };

/**
 * Desktop-specific operations interface.
 * Implementation lives in apps/desktop using @tauri-apps/plugin-* APIs.
 */
export interface DesktopFileOps {
  /**
   * Show open dialog and return selected file path
   */
  showOpenDialog(): Promise<string | null>;

  /**
   * Show save dialog and return selected file path
   */
  showSaveDialog(defaultName?: string): Promise<string | null>;

  /**
   * Read a file from disk
   */
  readFile(path: string): Promise<string>;

  /**
   * Write a file to disk
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Get recent files list
   */
  getRecentFiles(): Promise<FileHandle[]>;

  /**
   * Add a file to recent files list
   */
  addRecentFile(handle: FileHandle): Promise<void>;

  /**
   * Remove a file from recent files list
   */
  removeRecentFile(path: string): Promise<void>;

  /**
   * Clear all recent files
   */
  clearRecentFiles(): Promise<void>;
}

/**
 * Create a loaded document from desktop file data
 */
export function loadedDocFromFileData(data: DesktopFileData): LoadedDoc {
  return { pages: data.doc.pages, shapes: data.doc.shapes, bindings: data.doc.bindings, order: data.order };
}

/**
 * Create file data from document parts
 */
export function createFileData(
  board: BoardMeta,
  pages: Record<string, PageRecord>,
  shapes: Record<string, ShapeRecord>,
  bindings: Record<string, BindingRecord>,
  order: DocOrder,
): DesktopFileData {
  return { board, doc: { pages, shapes, bindings }, order };
}

export function parseDesktopFile(content: string): DesktopFileData {
  const data = JSON.parse(content) as DesktopFileData;

  if (!data.board || !data.doc || !data.order) {
    throw new Error("Invalid file format: missing required fields");
  }

  return data;
}

export function serializeDesktopFile(data: DesktopFileData): string {
  return JSON.stringify(data, null, 2);
}
