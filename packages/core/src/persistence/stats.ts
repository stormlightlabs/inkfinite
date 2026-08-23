import type { Timestamp } from './repo';

export type BoardStats = {
	pageCount: number;
	shapeCount: number;
	bindingCount: number;
	/** Optional counts supplied by adapters with layer and asset materialization. */
	layerCount?: number;
	assetCount?: number;
	docSizeBytes: number;
	lastUpdated: Timestamp;
};

/** Document-level details useful when investigating a board's persisted state. */
export type BoardDocumentDiagnostics = { documentId?: string; formatVersion?: number; canonical: boolean };

export type SchemaInfo = { declaredVersion: number; installedVersion: number };

export type BoardInspectorData = {
	/** Human-readable storage backend supplied by the application adapter. */
	storageType: string;
	stats: BoardStats;
	schema: SchemaInfo;
	/** Optional document identity and representation details from the adapter. */
	document?: BoardDocumentDiagnostics;
};

/**
 * Calculate board statistics from row counts and doc size.
 */
export const BoardStatsOps = {
	create(options: {
		pageCount: number;
		shapeCount: number;
		bindingCount: number;
		layerCount?: number;
		assetCount?: number;
		docSizeBytes: number;
		lastUpdated: Timestamp;
	}): BoardStats {
		return {
			pageCount: options.pageCount,
			shapeCount: options.shapeCount,
			bindingCount: options.bindingCount,
			...(options.layerCount !== undefined ? { layerCount: options.layerCount } : {}),
			...(options.assetCount !== undefined ? { assetCount: options.assetCount } : {}),
			docSizeBytes: options.docSizeBytes,
			lastUpdated: options.lastUpdated
		};
	},

	/**
	 * Format doc size in human-readable format (e.g., "1.2 KB", "3.4 MB")
	 */
	formatDocSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
};
