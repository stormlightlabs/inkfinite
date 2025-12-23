import {
  FileBrowserVM,
  getBoardInspectorData,
  InkfiniteDB,
  KNOWN_MIGRATION_IDS,
  type BoardInspectorData,
  type FileBrowserViewModel,
  type PersistentDocRepo,
} from "inkfinite-core";

export class FileBrowserController {
  open = $state(false);
  vm = $state<FileBrowserViewModel | null>(null);

  constructor(
    private getRepo: () => PersistentDocRepo | null,
  ) {}

  handleOpen = () => {
    this.open = true;
    void this.refreshBoards();
  };

  handleClose = () => {
    this.open = false;
  };

  handleUpdate = (vm: FileBrowserViewModel) => {
    this.vm = vm;
    void this.refreshBoards();
  };

  refreshBoards = async () => {
    const repo = this.getRepo();
    if (!repo) {
      return;
    }
    try {
      const boards = await repo.listBoards();
      if (this.vm) {
        this.vm = FileBrowserVM.setBoards(this.vm, boards);
      } else if (repo) {
        this.vm = FileBrowserVM.create({ repo, boards });
      }
    } catch (error) {
      console.error("Failed to list boards", error);
    }
  };

  fetchInspectorData = async (boardId: string, webDb: InkfiniteDB | null): Promise<BoardInspectorData> => {
    if (!webDb) {
      throw new Error("Database not available");
    }
    return getBoardInspectorData(webDb, boardId, KNOWN_MIGRATION_IDS);
  };
}
