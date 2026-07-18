import { createStatusStore, type EditorPlatformAdapter } from "@inkfinite/ui/editor";
import { createDesktopFileOps } from "./fileops";
import { createDesktopPersistenceSink, createDesktopSessionRepo } from "./persistence/desktop-session";

/** Creates the Tauri application's Rust-session-backed editor adapter. */
export function createDesktopPlatformAdapter(): EditorPlatformAdapter {
  return {
    kind: "desktop",
    async connect() {
      const repo = createDesktopSessionRepo(createDesktopFileOps());
      return {
        repo,
        desktop: repo,
        sink: createDesktopPersistenceSink(repo),
        status: createStatusStore({ backend: "filesystem", state: "saved", pendingWrites: 0 }),
      };
    },
  };
}
