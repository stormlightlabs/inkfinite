/**
 * File handle for desktop - just the path
 */
export type FileHandle = { path: string; name: string };

/**
 * Directory entry from file system
 */
export type DirectoryEntry = { path: string; name: string; isDir: boolean };

/**
 * Desktop-specific operations interface.
 *
 * Document contents are intentionally absent. The Rust session service owns
 * all document reads and writes; this interface is limited to dialogs,
 * metadata, and workspace navigation needed by the shared frontend.
 */
export interface DesktopFileOps {
	/**
	 * Show open dialog and return selected file path
	 */
	showOpenDialog(): Promise<string | null>;

	/**
	 * Show save dialog and return selected file path
	 */
	showSaveDialog(defaultName?: string): Promise<string | null>;

	/**
	 * Get recent files list
	 */
	getRecentFiles(): Promise<FileHandle[]>;

	/**
	 * Add a file to recent files list
	 */
	addRecentFile(handle: FileHandle): Promise<void>;

	/**
	 * Remove a file from recent files list
	 */
	removeRecentFile(path: string): Promise<void>;

	/**
	 * Clear all recent files
	 */
	clearRecentFiles(): Promise<void>;

	/**
	 * Get current workspace directory
	 */
	getWorkspaceDir(): Promise<string | null>;

	/**
	 * Set workspace directory
	 */
	setWorkspaceDir(path: string | null): Promise<void>;

	/**
	 * Show directory picker and set as workspace
	 */
	pickWorkspaceDir(): Promise<string | null>;

	/**
	 * Read directory contents (filtered by pattern)
	 */
	readDirectory(directory: string, pattern?: string): Promise<DirectoryEntry[]>;

	/**
	 * Rename a file on disk
	 */
	renameFile(oldPath: string, newPath: string): Promise<void>;

	/**
	 * Delete a file from disk
	 */
	deleteFile(path: string): Promise<void>;
}
