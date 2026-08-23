import type { BoardMeta, DocRepo } from '../persistence/repo';

export type FileBrowserActions = {
	open(boardId: string): Promise<void>;
	create(name: string): Promise<string>;
	rename(boardId: string, name: string): Promise<void>;
	delete(boardId: string): Promise<void>;
};

/** Sort orders offered by the board browser. */
export type FileBrowserSort = 'updated-desc' | 'created-desc' | 'name-asc' | 'name-desc';

export type FileBrowserViewModel = {
	/** All known boards pulled from the DocRepo */
	boards: BoardMeta[];
	/** Current search query */
	query: string;
	/** Boards that match the query in the selected sort order */
	filteredBoards: BoardMeta[];
	/** Selected board identifier, or null if nothing is selected */
	selectedId: string | null;
	/** Current board sort order. */
	sort: FileBrowserSort;
	/** Bound repository actions */
	actions: FileBrowserActions;
};

export type FileBrowserOptions = {
	repo: DocRepo;
	boards?: BoardMeta[];
	query?: string;
	selectedId?: string | null;
	sort?: FileBrowserSort;
};

export const FileBrowserVM = {
	create(options: FileBrowserOptions): FileBrowserViewModel {
		const sort = options.sort ?? 'updated-desc';
		const boards = sortBoards(options.boards ?? [], sort);
		const query = normalizeQuery(options.query);
		const filteredBoards = filterBoards(boards, query);
		const selectedId = resolveSelection(options.selectedId ?? null, filteredBoards);
		const actions = createActions(options.repo);
		return { boards, query, filteredBoards, selectedId, sort, actions };
	},

	setBoards(vm: FileBrowserViewModel, boards: BoardMeta[]): FileBrowserViewModel {
		const cloned = sortBoards(boards, vm.sort);
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

	setSort(vm: FileBrowserViewModel, sort: FileBrowserSort): FileBrowserViewModel {
		const boards = sortBoards(vm.boards, sort);
		const filteredBoards = filterBoards(boards, vm.query);
		const selectedId = resolveSelection(vm.selectedId, filteredBoards);
		return { ...vm, boards, filteredBoards, selectedId, sort };
	},

	select(vm: FileBrowserViewModel, boardId: string | null): FileBrowserViewModel {
		const selectedId = resolveSelection(boardId, vm.filteredBoards);
		return { ...vm, selectedId };
	}
};

function normalizeQuery(query?: string | null): string {
	return query?.trim() ?? '';
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

function sortBoards(boards: BoardMeta[], sort: FileBrowserSort): BoardMeta[] {
	return boards
		.map((board, index) => ({ board, index }))
		.sort((left, right) => {
			const comparison = compareBoards(left.board, right.board, sort);
			return comparison || left.index - right.index;
		})
		.map(({ board }) => board);
}

function compareBoards(left: BoardMeta, right: BoardMeta, sort: FileBrowserSort): number {
	switch (sort) {
		case 'name-asc':
			return compareText(left.name, right.name);
		case 'name-desc':
			return compareText(right.name, left.name);
		case 'created-desc':
			return compareNumber(right.createdAt, left.createdAt) || compareText(left.name, right.name);
		case 'updated-desc':
			return compareNumber(right.updatedAt, left.updatedAt) || compareText(left.name, right.name);
	}
}

function compareText(left: string, right: string): number {
	return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function compareNumber(left: number, right: number): number {
	const leftValue = Number.isFinite(left) && left > 0 ? left : -Infinity;
	const rightValue = Number.isFinite(right) && right > 0 ? right : -Infinity;
	return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
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
		}
	};
}
