import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import type { DesktopFileOps, DirectoryEntry, FileHandle } from "inkfinite-core";

export type { DesktopFileOps };

const STORE_NAME = "inkfinite-desktop.json";
const RECENT_FILES_KEY = "recentFiles";
const WORKSPACE_DIR_KEY = "workspaceDir";
const MAX_RECENT_FILES = 10;

type FileEntry = { path: string; name: string; is_dir: boolean };

/**
 * Create desktop file operations using Tauri APIs
 */
export function createDesktopFileOps(): DesktopFileOps {
  let storePromise: Promise<Awaited<ReturnType<typeof load>>> | null = null;

  async function getStore() {
    if (!storePromise) {
      storePromise = load(STORE_NAME);
    }
    return storePromise;
  }

  async function showOpenDialog(): Promise<string | null> {
    const result = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Inkfinite Files", extensions: ["inkfinite.json", "json"] }],
    });

    return result;
  }

  async function showSaveDialog(defaultName?: string): Promise<string | null> {
    const result = await save({
      defaultPath: defaultName || "Untitled.inkfinite.json",
      filters: [{ name: "Inkfinite Files", extensions: ["inkfinite.json"] }],
    });

    return result;
  }

  async function readFile(path: string): Promise<string> {
    return readTextFile(path);
  }

  async function writeFile(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
  }

  async function getRecentFiles(): Promise<FileHandle[]> {
    const store = await getStore();
    const recent = (await store.get<FileHandle[]>(RECENT_FILES_KEY)) || [];
    return recent;
  }

  async function addRecentFile(handle: FileHandle): Promise<void> {
    const store = await getStore();
    const recent = (await store.get<FileHandle[]>(RECENT_FILES_KEY)) || [];
    const filtered = recent.filter((f) => f.path !== handle.path);
    const updated = [handle, ...filtered].slice(0, MAX_RECENT_FILES);
    await store.set(RECENT_FILES_KEY, updated);
    await store.save();
  }

  async function removeRecentFile(path: string): Promise<void> {
    const store = await getStore();
    const recent = (await store.get<FileHandle[]>(RECENT_FILES_KEY)) || [];
    const filtered = recent.filter((f) => f.path !== path);
    await store.set(RECENT_FILES_KEY, filtered);
    await store.save();
  }

  async function clearRecentFiles(): Promise<void> {
    const store = await getStore();
    await store.set(RECENT_FILES_KEY, []);
    await store.save();
  }

  async function getWorkspaceDir(): Promise<string | null> {
    const store = await getStore();
    const workspace = (await store.get<string | null>(WORKSPACE_DIR_KEY)) || null;
    return workspace;
  }

  async function setWorkspaceDir(path: string | null): Promise<void> {
    const store = await getStore();
    await store.set(WORKSPACE_DIR_KEY, path);
    await store.save();
  }

  async function pickWorkspaceDir(): Promise<string | null> {
    const result = await invoke<string | null>("pick_workspace_directory");
    if (result) {
      await setWorkspaceDir(result);
    }
    return result;
  }

  async function readDirectory(directory: string, pattern?: string): Promise<DirectoryEntry[]> {
    const entries = await invoke<FileEntry[]>("read_directory", { directory, pattern: pattern || "*.inkfinite.json" });

    return entries.map((e) => ({ path: e.path, name: e.name, isDir: e.is_dir }));
  }

  async function renameFile(oldPath: string, newPath: string): Promise<void> {
    await invoke("rename_file", { oldPath, newPath });
  }

  async function deleteFile(path: string): Promise<void> {
    await invoke("delete_file", { filePath: path });
  }

  return {
    showOpenDialog,
    showSaveDialog,
    readFile,
    writeFile,
    getRecentFiles,
    addRecentFile,
    removeRecentFile,
    clearRecentFiles,
    getWorkspaceDir,
    setWorkspaceDir,
    pickWorkspaceDir,
    readDirectory,
    renameFile,
    deleteFile,
  };
}
