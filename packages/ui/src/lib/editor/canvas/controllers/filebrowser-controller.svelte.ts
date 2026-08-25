import { FileBrowserVM, type FileBrowserViewModel } from '../../filebrowser/model';
import type {
	BoardInspectorData,
	LoadedDoc,
	PersistentDocRepo
} from '@inkfinite/core/persistence';

export class FileBrowserController {
	open = $state(false);
	vm = $state<FileBrowserViewModel | null>(null);

	constructor(
		private getRepo: () => PersistentDocRepo | null,
		private onLoadDoc?: (boardId: string, doc: LoadedDoc) => void,
		private getInspector?: () =>
			| ((boardId: string) => Promise<BoardInspectorData>)
			| undefined,
		private prepareToSwitch?: () => Promise<void>,
		private onError?: (error: unknown, title?: string) => void
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
			this.onError?.(error, 'Document error');
		}
	};

	fetchInspectorData = async (boardId: string): Promise<BoardInspectorData> => {
		const inspect = this.getInspector?.();
		if (!inspect) throw new Error('Board inspection is not available on this platform');
		return inspect(boardId);
	};

	private createBrowserRepo(repo: PersistentDocRepo): PersistentDocRepo {
		const onLoadDoc = this.onLoadDoc;
		const prepareToSwitch = this.prepareToSwitch;
		const onError = this.onError;
		return {
			...repo,
			async openBoard(boardId) {
				try {
					await prepareToSwitch?.();
					await repo.openBoard(boardId);
					const doc = await repo.loadDoc(boardId);
					onLoadDoc?.(boardId, doc);
				} catch (error) {
					onError?.(error, 'Load document failed');
					throw error;
				}
			},
			async duplicateBoard(boardId, name) {
				try {
					await prepareToSwitch?.();
					const duplicateId = await repo.duplicateBoard(boardId, name);
					const doc = await repo.loadDoc(duplicateId);
					onLoadDoc?.(duplicateId, doc);
					return duplicateId;
				} catch (error) {
					onError?.(error, 'Duplicate board failed');
					throw error;
				}
			},
			async deleteBoard(boardId) {
				try {
					await prepareToSwitch?.();
					await repo.deleteBoard(boardId);
				} catch (error) {
					onError?.(error, 'Delete board failed');
					throw error;
				}
			}
		};
	}
}
