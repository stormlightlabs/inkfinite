import type { DocRepo } from "inkfinite-core";
import { createWebDocRepo, InkfiniteDB } from "inkfinite-core";
import { createDesktopFileOps } from "./fileops";
import { createDesktopDocRepo, type DesktopDocRepo } from "./persistence/desktop";

export type Platform = "web" | "desktop";

export function detectPlatform(): Platform {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return "desktop";
  }
  return "web";
}

export type PlatformRepoResult = { repo: DocRepo; platform: Platform; db?: InkfiniteDB; desktop?: DesktopDocRepo };

/**
 * Create the appropriate DocRepo based on platform
 */
export async function createPlatformRepo(): Promise<PlatformRepoResult> {
  const platform = detectPlatform();

  if (platform === "desktop") {
    const fileOps = createDesktopFileOps();
    const repo = createDesktopDocRepo(fileOps);
    return { repo, platform, desktop: repo };
  } else {
    const db = new InkfiniteDB();
    const repo = createWebDocRepo(db);
    return { repo, platform, db };
  }
}
