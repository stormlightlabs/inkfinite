import type { BoardMeta, LoadedDoc, PersistentDocRepo } from '@inkfinite/core';
import type { DesktopDocumentRepo } from '../../platform';

function isUserCancelled(error: unknown) {
	return error instanceof Error && /cancel/i.test(error.message);
}

export class DesktopFileController {
	boards = $state<BoardMeta[]>([]);
	isDraft = $state(false);

	constructor(
		private getRepo: () => PersistentDocRepo | null,
		private getDesktopRepo: () => DesktopDocumentRepo | null,
		private onLoadDoc: (boardId: string, doc: LoadedDoc) => void,
		private prepareToSwitch: () => Promise<void>
	) {}

	get repo(): DesktopDocumentRepo | null {
		return this.getDesktopRepo();
	}

	openDraft = async () => {
		const desktopRepo = this.getDesktopRepo();
		if (!desktopRepo) return;
		const opened = await desktopRepo.openDraft();
		this.isDraft = true;
		this.onLoadDoc(opened.boardId, opened.doc);
		await this.refreshBoards();
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
			const opened = await desktopRepo.openFromDialog(this.prepareToSwitch);
			this.isDraft = false;
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
			await this.prepareToSwitch();
			const boardId = await repo.createBoard('Untitled');
			const loaded = await repo.loadDoc(boardId);
			this.isDraft = false;
			this.onLoadDoc(boardId, loaded);
			await this.refreshBoards();
		} catch (error) {
			if (isUserCancelled(error)) {
				return;
			}
			console.error('Failed to create board', error);
		}
	};

	handleSaveAs = async (prepareToSave?: () => Promise<void>) => {
		const desktopRepo = this.getDesktopRepo();
		if (!desktopRepo) {
			return;
		}
		try {
			const { boardId, doc } = await desktopRepo.saveAs(prepareToSave);
			this.isDraft = false;
			this.onLoadDoc(boardId, doc);
			await this.refreshBoards();
		} catch (error) {
			if (isUserCancelled(error)) {
				return;
			}
			console.error('Failed to save board', error);
		}
	};

	markImported = async () => {
		this.isDraft = false;
		await this.refreshBoards();
	};

	handleRecentSelect = async (boardId: string) => {
		const repo = this.getRepo();
		const desktopRepo = this.getDesktopRepo();
		if (!repo) {
			return;
		}
		try {
			await this.prepareToSwitch();
			const loaded = await repo.loadDoc(boardId);
			this.isDraft = desktopRepo?.isDraft() ?? false;
			this.onLoadDoc(boardId, loaded);
			await this.refreshBoards();
		} catch (error) {
			console.error('Failed to load board', error);
		}
	};
}
