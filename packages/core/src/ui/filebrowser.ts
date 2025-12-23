import type { BoardMeta, DocRepo } from "../persist/DocRepo";

export type FileBrowserActions = {
  open(boardId: string): Promise<void>;
  create(name: string): Promise<string>;
  rename(boardId: string, name: string): Promise<void>;
  delete(boardId: string): Promise<void>;
};

export type FileBrowserViewModel = {
  /** All known boards pulled from the DocRepo */
  boards: BoardMeta[];
  /** Current search query */
  query: string;
  /** Boards that match the query (preserves incoming order) */
  filteredBoards: BoardMeta[];
  /** Selected board identifier, or null if nothing is selected */
  selectedId: string | null;
  /** Bound repository actions */
  actions: FileBrowserActions;
};

export type FileBrowserOptions = { repo: DocRepo; boards?: BoardMeta[]; query?: string; selectedId?: string | null };

export const FileBrowserVM = {
  create(options: FileBrowserOptions): FileBrowserViewModel {
    const boards = [...(options.boards ?? [])];
    const query = normalizeQuery(options.query);
    const filteredBoards = filterBoards(boards, query);
    const selectedId = resolveSelection(options.selectedId ?? null, filteredBoards);
    const actions = createActions(options.repo);
    return { boards, query, filteredBoards, selectedId, actions };
  },

  setBoards(vm: FileBrowserViewModel, boards: BoardMeta[]): FileBrowserViewModel {
    const cloned = [...boards];
    const filteredBoards = filterBoards(cloned, vm.query);
    const selectedId = resolveSelection(vm.selectedId, filteredBoards);
    return { ...vm, boards: cloned, filteredBoards, selectedId };
  },

  setQuery(vm: FileBrowserViewModel, query: string): FileBrowserViewModel {
    const normalized = normalizeQuery(query);
    const filteredBoards = filterBoards(vm.boards, normalized);
    const selectedId = resolveSelection(vm.selectedId, filteredBoards);
    return { ...vm, query: normalized, filteredBoards, selectedId };
  },

  select(vm: FileBrowserViewModel, boardId: string | null): FileBrowserViewModel {
    const selectedId = resolveSelection(boardId, vm.filteredBoards);
    return { ...vm, selectedId };
  },
};

function normalizeQuery(query?: string | null): string {
  return query?.trim() ?? "";
}

function filterBoards(boards: BoardMeta[], query: string): BoardMeta[] {
  if (!query) {
    return [...boards];
  }
  const needle = query.toLowerCase();
  return boards.filter((board) => {
    const nameMatch = board.name.toLowerCase().includes(needle);
    const idMatch = board.id.toLowerCase().includes(needle);
    return nameMatch || idMatch;
  });
}

function resolveSelection(requested: string | null, boards: BoardMeta[]): string | null {
  if (requested && boards.some((board) => board.id === requested)) {
    return requested;
  }
  return boards[0]?.id ?? null;
}

function createActions(repo: DocRepo): FileBrowserActions {
  return {
    async open(boardId: string) {
      await repo.openBoard(boardId);
    },
    async create(name: string) {
      return repo.createBoard(name);
    },
    async rename(boardId: string, name: string) {
      await repo.renameBoard(boardId, name);
    },
    async delete(boardId: string) {
      await repo.deleteBoard(boardId);
    },
  };
}
