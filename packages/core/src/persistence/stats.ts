import type { Timestamp } from "./repo";

export type BoardStats = {
  pageCount: number;
  shapeCount: number;
  bindingCount: number;
  docSizeBytes: number;
  lastUpdated: Timestamp;
};

export type SchemaInfo = { declaredVersion: number; installedVersion: number };

export type BoardInspectorData = {
  /** Human-readable storage backend supplied by the application adapter. */
	storageType: string;
	stats: BoardStats;
	schema: SchemaInfo;
};

/**
 * Calculate board statistics from row counts and doc size.
 */
export const BoardStatsOps = {
  create(
    options: {
      pageCount: number;
      shapeCount: number;
      bindingCount: number;
      docSizeBytes: number;
      lastUpdated: Timestamp;
    },
  ): BoardStats {
    return {
      pageCount: options.pageCount,
      shapeCount: options.shapeCount,
      bindingCount: options.bindingCount,
      docSizeBytes: options.docSizeBytes,
      lastUpdated: options.lastUpdated,
    };
  },

  /**
   * Format doc size in human-readable format (e.g., "1.2 KB", "3.4 MB")
   */
  formatDocSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  },
};
