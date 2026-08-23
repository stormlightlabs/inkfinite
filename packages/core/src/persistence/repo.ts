export type Timestamp = number;

/** Where a board is currently listed by the application. */
export type BoardStorage = { kind: 'browser' | 'workspace' | 'recent'; label: string; location?: string };

export type BoardMeta = {
	id: string;
	name: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
	/** Optional storage details supplied by the application adapter. */
	storage?: BoardStorage;
};

/**
 * Shared document repository contract used by both web and desktop persistence layers.
 */
export interface DocRepo {
	/**
	 * Fetch all boards ordered by most recently updated first.
	 */
	listBoards(): Promise<BoardMeta[]>;

	/**
	 * Create a new board and return its identifier.
	 */
	createBoard(name: string): Promise<string>;

	/**
	 * Load the requested board into the active editing context.
	 */
	openBoard(boardId: string): Promise<void>;

	/**
	 * Rename the board.
	 */
	renameBoard(boardId: string, name: string): Promise<void>;

	/**
	 * Delete the board and all associated records.
	 */
	deleteBoard(boardId: string): Promise<void>;
}
