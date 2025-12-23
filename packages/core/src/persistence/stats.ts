import type { Timestamp } from "./repo";

export type BoardStats = {
  pageCount: number;
  shapeCount: number;
  bindingCount: number;
  docSizeBytes: number;
  lastUpdated: Timestamp;
};

export type SchemaInfo = { declaredVersion: number; installedVersion: number };

export type MigrationInfo = { id: string; appliedAt: Timestamp };

export type BoardInspectorData = {
  stats: BoardStats;
  schema: SchemaInfo;
  migrations: MigrationInfo[];
  pendingMigrations: string[];
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

/**
 * Determine pending migrations by comparing known migration list with applied migrations.
 */
export function getPendingMigrations(knownMigrationIds: string[], appliedMigrations: MigrationInfo[]): string[] {
  const appliedIds = new Set(appliedMigrations.map((m) => m.id));
  return knownMigrationIds.filter((id) => !appliedIds.has(id));
}
