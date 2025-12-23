import type { DesktopDocRepo } from "$lib/persistence/desktop";
import type { BoardMeta, LoadedDoc, PersistentDocRepo } from "inkfinite-core";

function isUserCancelled(error: unknown) {
  return error instanceof Error && /cancel/i.test(error.message);
}

export class DesktopFileController {
  boards = $state<BoardMeta[]>([]);
  fileName = $state<string | null>(null);

  constructor(
    private getRepo: () => PersistentDocRepo | null,
    private getDesktopRepo: () => DesktopDocRepo | null,
    private onLoadDoc: (boardId: string, doc: LoadedDoc) => void,
  ) {}

  private updateFileState = () => {
    const desktopRepo = this.getDesktopRepo();
    if (!desktopRepo) {
      this.fileName = null;
      return;
    }
    const handle = desktopRepo.getCurrentFile();
    this.fileName = handle?.name ?? null;
  };

  refreshBoards = async (): Promise<BoardMeta[]> => {
    const desktopRepo = this.getDesktopRepo();
    if (!desktopRepo) {
      this.boards = [];
      return [];
    }
    try {
      const boards = await desktopRepo.listBoards();
      this.boards = boards;
      return boards;
    } catch (error) {
      console.error("Failed to list boards", error);
      this.boards = [];
      return [];
    }
  };

  handleOpen = async () => {
    const desktopRepo = this.getDesktopRepo();
    const repo = this.getRepo();
    if (!desktopRepo || !repo) {
      return;
    }
    try {
      const opened = await desktopRepo.openFromDialog();
      this.onLoadDoc(opened.boardId, opened.doc);
      this.updateFileState();
      await this.refreshBoards();
    } catch (error) {
      if (isUserCancelled(error)) {
        return;
      }
      console.error("Failed to open board", error);
    }
  };

  handleNew = async () => {
    const repo = this.getRepo();
    if (!repo) {
      return;
    }
    try {
      const boardId = await repo.createBoard("Untitled");
      const loaded = await repo.loadDoc(boardId);
      this.onLoadDoc(boardId, loaded);
      this.updateFileState();
      await this.refreshBoards();
    } catch (error) {
      if (isUserCancelled(error)) {
        return;
      }
      console.error("Failed to create board", error);
    }
  };

  handleSaveAs = async (activeBoardId: string | null) => {
    const repo = this.getRepo();
    if (!repo || !activeBoardId) {
      return;
    }
    try {
      const snapshot = await repo.exportBoard(activeBoardId);
      const newBoardId = await repo.importBoard(snapshot);
      const loaded = await repo.loadDoc(newBoardId);
      this.onLoadDoc(newBoardId, loaded);
      this.updateFileState();
      await this.refreshBoards();
    } catch (error) {
      if (isUserCancelled(error)) {
        return;
      }
      console.error("Failed to save board", error);
    }
  };

  handleRecentSelect = async (boardId: string) => {
    const repo = this.getRepo();
    if (!repo) {
      return;
    }
    try {
      const loaded = await repo.loadDoc(boardId);
      this.onLoadDoc(boardId, loaded);
      this.updateFileState();
      await this.refreshBoards();
    } catch (error) {
      console.error("Failed to load board", error);
    }
  };
}
