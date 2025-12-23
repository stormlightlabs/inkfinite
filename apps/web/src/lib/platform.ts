import type { DocRepo } from "inkfinite-core";
import { createWebDocRepo, InkfiniteDB } from "inkfinite-core";
import { createDesktopFileOps } from "./fileops";
import { createDesktopDocRepo } from "./persistence/desktop";

export type Platform = "web" | "desktop";

/**
 * Detect if we're running in Tauri
 */
export function detectPlatform(): Platform {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return "desktop";
  }
  return "web";
}

/**
 * Create the appropriate DocRepo based on platform
 */
export async function createPlatformRepo(): Promise<{ repo: DocRepo; platform: Platform; db?: InkfiniteDB }> {
  const platform = detectPlatform();

  if (platform === "desktop") {
    const fileOps = createDesktopFileOps();
    const repo = createDesktopDocRepo(fileOps);
    return { repo, platform };
  } else {
    const db = new InkfiniteDB();
    const repo = createWebDocRepo(db);
    return { repo, platform, db };
  }
}
