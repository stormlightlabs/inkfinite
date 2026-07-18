import type { PersistentDocRepo } from "@inkfinite/core";
import { createWebDocRepo, InkfiniteDB } from "@inkfinite/core";
import { createDesktopFileOps } from "./fileops";
import { createDesktopSessionRepo, type DesktopSessionRepo } from "./persistence/desktop-session";

export type Platform = "web" | "desktop";

export function detectPlatform(): Platform {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return "desktop";
  }
  return "web";
}

export type PlatformRepoResult = {
  repo: PersistentDocRepo;
  platform: Platform;
  db?: InkfiniteDB;
  desktop?: DesktopSessionRepo;
};

/**
 * Create the appropriate DocRepo based on platform
 */
export async function createPlatformRepo(): Promise<PlatformRepoResult> {
  const platform = detectPlatform();

  if (platform === "desktop") {
    const fileOps = createDesktopFileOps();
    const repo = createDesktopSessionRepo(fileOps);
    return { repo, platform, desktop: repo };
  } else {
    const db = new InkfiniteDB();
    const repo = createWebDocRepo(db);
    return { repo, platform, db };
  }
}
