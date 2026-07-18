import {
  FileBrowserVM,
  type BoardInspectorData,
  type FileBrowserViewModel,
  type PersistentDocRepo,
} from "@inkfinite/core";
import type { LoadedDoc } from "@inkfinite/core";

export class FileBrowserController {
  open = $state(false);
  vm = $state<FileBrowserViewModel | null>(null);

  constructor(
    private getRepo: () => PersistentDocRepo | null,
    private onLoadDoc?: (boardId: string, doc: LoadedDoc) => void,
    private getInspector?: () => ((boardId: string) => Promise<BoardInspectorData>) | undefined,
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
        this.vm = FileBrowserVM.create({ repo: this.createBrowserRepo(repo), boards });
      }
    } catch (error) {
      console.error("Failed to list boards", error);
    }
  };

  fetchInspectorData = async (boardId: string): Promise<BoardInspectorData> => {
    const inspect = this.getInspector?.();
    if (!inspect) throw new Error("Board inspection is not available on this platform");
    return inspect(boardId);
  };

  private createBrowserRepo(repo: PersistentDocRepo): PersistentDocRepo {
    const onLoadDoc = this.onLoadDoc;
    return {
      ...repo,
      async openBoard(boardId) {
        await repo.openBoard(boardId);
        const doc = await repo.loadDoc(boardId);
        onLoadDoc?.(boardId, doc);
      },
    };
  }
}
