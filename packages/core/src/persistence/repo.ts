export type Timestamp = number;

export type BoardMeta = { id: string; name: string; createdAt: Timestamp; updatedAt: Timestamp };

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
