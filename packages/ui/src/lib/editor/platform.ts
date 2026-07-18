import type {
  BoardInspectorData,
  FileHandle,
  PersistenceSink,
  PersistenceStatus,
  PersistentDocRepo,
} from "@inkfinite/core";
import type { StatusStore } from "./status";

/** Runtime selected by an application composition root. */
export type EditorPlatform = "web" | "desktop";

/**
 * Desktop-only capabilities consumed by the shared editor.
 *
 * The Tauri adapter implements this contract without exposing Tauri APIs to
 * the editor package.
 */
export interface DesktopDocumentRepo extends PersistentDocRepo {
  getCurrentFile(): FileHandle | null;
  openFromDialog(): Promise<{ boardId: string; doc: import("@inkfinite/core").LoadedDoc }>;
  getWorkspaceDir(): Promise<string | null>;
  setWorkspaceDir(path: string | null): Promise<void>;
  pickWorkspaceDir(): Promise<string | null>;
  closeSession(): Promise<void>;
}

/** Connected persistence services used for one mounted editor. */
export type EditorPlatformSession = {
  repo: PersistentDocRepo;
  sink: PersistenceSink;
  status: StatusStore;
  desktop?: DesktopDocumentRepo;
  inspectBoard?: (boardId: string) => Promise<BoardInspectorData>;
  setActiveBoard?: (boardId: string | null) => void;
  dispose?: () => void;
};

/** Application-owned adapter that connects the editor to durable storage. */
export interface EditorPlatformAdapter {
  readonly kind: EditorPlatform;
  connect(): Promise<EditorPlatformSession>;
}

/** Creates the initial status shown while an application adapter connects. */
export function initialPersistenceStatus(platform: EditorPlatform): PersistenceStatus {
  return {
    backend: platform === "desktop" ? "filesystem" : "indexeddb",
    state: "saved",
    pendingWrites: 0,
  };
}
