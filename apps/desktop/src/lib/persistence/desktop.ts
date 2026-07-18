/**
 * Compatibility exports for desktop consumers.
 *
 * The desktop implementation is Rust-owned. Keep the historical module path
 * available while routing every caller to the session-backed adapter.
 */
export {
  createDesktopSessionRepo as createDesktopDocRepo,
  isDesktopSessionRepo as isDesktopRepo,
} from "./desktop-session";
export type { DesktopSessionRepo as DesktopDocRepo } from "./desktop-session";

import type { FileHandle, PersistentDocRepo } from "@inkfinite/core";
import { isDesktopSessionRepo } from "./desktop-session";

/** Returns the path currently held by a Rust-backed desktop session. */
export function getCurrentFile(repo: PersistentDocRepo): FileHandle | null {
  return isDesktopSessionRepo(repo) ? repo.getCurrentFile() : null;
}
