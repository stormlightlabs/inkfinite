import {
	diffDoc,
	type BoardMeta,
	type Document,
	type LoadedDoc,
	type PersistentDocRepo
} from '@inkfinite/core';
import type { DesktopDocumentRepo } from '../../platform';

function isUserCancelled(error: unknown) {
	return error instanceof Error && /cancel/i.test(error.message);
}

export class DesktopFileController {
	boards = $state<BoardMeta[]>([]);

	constructor(
		private getRepo: () => PersistentDocRepo | null,
		private getDesktopRepo: () => DesktopDocumentRepo | null,
		private onLoadDoc: (boardId: string, doc: LoadedDoc) => void,
		private getActiveBoardId: () => string | null,
		private getCurrentDocument: () => Document
	) {}

	get repo(): DesktopDocumentRepo | null {
		return this.getDesktopRepo();
	}

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
			console.error('Failed to list boards', error);
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
			await this.refreshBoards();
		} catch (error) {
			if (isUserCancelled(error)) {
				return;
			}
			console.error('Failed to open board', error);
		}
	};

	handleNew = async () => {
		const repo = this.getRepo();
		if (!repo) {
			return;
		}
		try {
			const boardId = await repo.createBoard('Untitled');
			const loaded = await repo.loadDoc(boardId);
			this.onLoadDoc(boardId, loaded);
			await this.refreshBoards();
		} catch (error) {
			if (isUserCancelled(error)) {
				return;
			}
			console.error('Failed to create board', error);
		}
	};

	handleSaveAs = async () => {
		const repo = this.getRepo();
		const activeBoardId = this.getActiveBoardId();
		if (!repo) {
			return;
		}
		try {
			if (!activeBoardId) {
				const unsavedDocument = this.getCurrentDocument();
				const boardId = await repo.createBoard('Untitled');
				const blank = await repo.loadDoc(boardId);
				await repo.applyDocPatch(
					boardId,
					diffDoc(
						{
							pages: blank.pages,
							layers: blank.layers ?? blank.order.layers,
							shapes: blank.shapes,
							bindings: blank.bindings
						},
						unsavedDocument
					)
				);
				const saved = await repo.loadDoc(boardId);
				this.onLoadDoc(boardId, saved);
				await this.refreshBoards();
				return;
			}
			const snapshot = await repo.exportBoard(activeBoardId);
			const newBoardId = await repo.importBoard(snapshot);
			const loaded = await repo.loadDoc(newBoardId);
			this.onLoadDoc(newBoardId, loaded);
			await this.refreshBoards();
		} catch (error) {
			if (isUserCancelled(error)) {
				return;
			}
			console.error('Failed to save board', error);
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
			await this.refreshBoards();
		} catch (error) {
			console.error('Failed to load board', error);
		}
	};
}
