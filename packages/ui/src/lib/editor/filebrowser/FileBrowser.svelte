<script lang="ts">
	import { Button, Icon, Sheet } from '../../index';
	import type { DesktopDocumentRepo } from '../platform';
	import type {
		BoardInspectorData,
		BoardMeta,
		FileBrowserSort,
		FileBrowserViewModel,
		PersistenceStatus
	} from '@inkfinite/core';
	import { BoardStatsOps, FileBrowserVM } from '@inkfinite/core';
	import type { StatusStore } from '../status';
	import type { Snippet } from 'svelte';

	type Props = {
		vm: FileBrowserViewModel;
		onUpdate?: (vm: FileBrowserViewModel) => void;
		fetchInspectorData?: (boardId: string) => Promise<BoardInspectorData>;
		open?: boolean;
		onClose?: () => void;
		children?: Snippet;
		desktopRepo?: DesktopDocumentRepo | null;
		activeBoardId?: string | null;
		persistence?: StatusStore;
		draft?: boolean;
	};

	let {
		vm = $bindable(),
		onUpdate,
		fetchInspectorData,
		open = $bindable(false),
		onClose: handleClose,
		children: _children,
		desktopRepo = null,
		activeBoardId = null,
		persistence,
		draft = false
	}: Props = $props();

	let searchQuery = $derived(vm.query);
	let inspectorOpen = $state(false);
	let inspectorData = $state<BoardInspectorData | null>(null);
	let inspectorBoard = $state<BoardMeta | null>(null);
	let inspectorLoading = $state(false);
	let inspectorError = $state<string | null>(null);

	let isCreating = $state(false);
	let newBoardName = $state('');
	let editingBoardId = $state<string | null>(null);
	let editingBoardName = $state('');

	let workspaceDir = $state<string | null>(null);
	let currentFilePath = $state<string | null>(null);
	let workspaceBusy = $state(false);
	let workspaceError = $state<string | null>(null);
	let actionBusy = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let persistenceSnapshot = $state<PersistenceStatus | null>(null);

	$effect(() => {
		const currentPersistence = persistence;
		if (!currentPersistence) {
			persistenceSnapshot = null;
			return;
		}
		persistenceSnapshot = currentPersistence.get();
		return currentPersistence.subscribe((status) => (persistenceSnapshot = status));
	});

	$effect(() => {
		const repo = desktopRepo;
		if (!repo || !open) {
			if (!repo) {
				workspaceDir = null;
				currentFilePath = null;
			}
			return;
		}
		let cancelled = false;
		void Promise.all([
			repo.getWorkspaceDir(),
			Promise.resolve(repo.getCurrentFile()?.path ?? null)
		])
			.then(([dir, path]) => {
				if (!cancelled) {
					workspaceDir = dir;
					currentFilePath = path;
				}
			})
			.catch((error) => {
				if (!cancelled) workspaceError = describeError(error);
			});
		return () => {
			cancelled = true;
		};
	});

	let activeBoard = $derived(vm.boards.find((board) => board.id === activeBoardId) ?? null);

	function applySearchQuery(nextQuery: string) {
		searchQuery = nextQuery;
		const updated = FileBrowserVM.setQuery(vm, nextQuery);
		vm = updated;
		onUpdate?.(updated);
	}

	function handleSearchInput(event: Event) {
		const target = event.target as HTMLInputElement;
		applySearchQuery(target.value);
	}

	function handleSearchChange() {
		applySearchQuery(searchQuery);
	}

	function applySort(value: string) {
		const sort = value as FileBrowserSort;
		if (!['updated-desc', 'created-desc', 'name-asc', 'name-desc'].includes(sort)) return;
		const updated = FileBrowserVM.setSort(vm, sort);
		vm = updated;
		onUpdate?.(updated);
	}

	function selectBoard(boardId: string) {
		vm = FileBrowserVM.select(vm, boardId);
	}

	function focusBoard(index: number) {
		const board = vm.filteredBoards[index];
		if (!board) return;
		selectBoard(board.id);
		const target = [...document.querySelectorAll<HTMLButtonElement>('[data-board-id]')].find(
			(element) => element.dataset.boardId === board.id
		);
		target?.focus();
	}

	function handleBoardKeydown(event: KeyboardEvent, boardId: string) {
		const index = vm.filteredBoards.findIndex((board) => board.id === boardId);
		if (index < 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focusBoard(Math.min(index + 1, vm.filteredBoards.length - 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			focusBoard(Math.max(index - 1, 0));
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusBoard(0);
		} else if (event.key === 'End') {
			event.preventDefault();
			focusBoard(vm.filteredBoards.length - 1);
		}
	}

	function closeBrowser() {
		open = false;
		handleClose?.();
	}

	function describeError(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function beginAction(action: string): boolean {
		if (actionBusy) return false;
		actionBusy = action;
		actionError = null;
		return true;
	}

	function endAction(action: string) {
		if (actionBusy === action) actionBusy = null;
	}

	function reportActionError(action: string, error: unknown) {
		actionError = `${action}: ${describeError(error)}`;
	}

	async function handleOpenBoard(boardId: string) {
		const board = vm.boards.find((item) => item.id === boardId);
		if (!beginAction(`open:${boardId}`)) return;
		try {
			await vm.actions.open(boardId);
			closeBrowser();
		} catch (error) {
			reportActionError(`Could not open ${board?.name ?? 'board'}`, error);
		} finally {
			endAction(`open:${boardId}`);
		}
	}

	async function handleCreateBoard() {
		if (!newBoardName.trim() || !beginAction('create')) return;
		try {
			const boardId = await vm.actions.create(newBoardName);
			isCreating = false;
			newBoardName = '';
			onUpdate?.(vm);
			await vm.actions.open(boardId);
			closeBrowser();
		} catch (error) {
			reportActionError('Could not create board', error);
		} finally {
			endAction('create');
		}
	}

	async function handleDuplicateBoard(board: BoardMeta) {
		if (!beginAction(`duplicate:${board.id}`)) return;
		try {
			await vm.actions.duplicate(board.id, `Copy of ${board.name}`);
			onUpdate?.(vm);
			closeBrowser();
		} catch (error) {
			reportActionError(`Could not duplicate ${board.name}`, error);
		} finally {
			endAction(`duplicate:${board.id}`);
		}
	}

	async function handleRenameBoard(boardId: string) {
		if (!editingBoardName.trim() || !beginAction(`rename:${boardId}`)) return;
		try {
			await vm.actions.rename(boardId, editingBoardName);
			editingBoardId = null;
			editingBoardName = '';
			onUpdate?.(vm);
		} catch (error) {
			reportActionError('Could not rename board', error);
		} finally {
			endAction(`rename:${boardId}`);
		}
	}

	async function handleDeleteBoard(boardId: string) {
		if (
			!confirm('Are you sure you want to delete this board? This action cannot be undone.')
		) {
			return;
		}
		const board = vm.boards.find((item) => item.id === boardId);
		if (!beginAction(`delete:${boardId}`)) return;
		try {
			await vm.actions.delete(boardId);
			if (inspectorOpen && inspectorBoard?.id === boardId) {
				inspectorOpen = false;
				inspectorData = null;
				inspectorBoard = null;
			}
			onUpdate?.(vm);
			if (activeBoardId === boardId) {
				const replacement = vm.boards.find((item) => item.id !== boardId);
				if (replacement) {
					await vm.actions.open(replacement.id);
				} else {
					const replacementId = await vm.actions.create('Untitled Board');
					await vm.actions.open(replacementId);
				}
				closeBrowser();
			}
		} catch (error) {
			reportActionError(`Could not delete ${board?.name ?? 'board'}`, error);
		} finally {
			endAction(`delete:${boardId}`);
		}
	}

	async function handleInspectBoard(board: BoardMeta) {
		inspectorBoard = board;
		inspectorOpen = true;
		inspectorLoading = true;
		inspectorError = null;
		inspectorData = null;

		if (!fetchInspectorData) {
			inspectorLoading = false;
			inspectorError = 'Board diagnostics are not available on this platform.';
			return;
		}

		try {
			inspectorData = await fetchInspectorData(board.id);
		} catch (error) {
			inspectorError = describeError(error);
		} finally {
			inspectorLoading = false;
		}
	}

	function formatTimestamp(timestamp: number): string {
		return timestamp > 0 ? new Date(timestamp).toLocaleString() : 'Not available';
	}

	function formatSaveState(): string {
		const status = persistenceSnapshot;
		if (!status) return draft ? 'Draft' : 'Saved';
		if (status.state === 'error')
			return status.errorMsg ? `Error: ${status.errorMsg}` : 'Error';
		if (status.state === 'saving' || (status.pendingWrites ?? 0) > 0)
			return draft ? 'Saving draft…' : 'Saving…';
		return draft ? 'Draft saved' : 'Saved';
	}

	function formatLastSaved(): string {
		return persistenceSnapshot?.lastSavedAt
			? formatTimestamp(persistenceSnapshot.lastSavedAt)
			: 'Not available';
	}

	function storageLabel(): string {
		if (activeBoard?.storage?.label) return activeBoard.storage.label;
		if (desktopRepo) return workspaceDir ? 'Workspace' : 'Recent files';
		return 'This browser';
	}

	function storageLocation(): string {
		return currentFilePath || activeBoard?.storage?.location || workspaceDir || 'IndexedDB';
	}

	function startRename(board: BoardMeta) {
		editingBoardId = board.id;
		editingBoardName = board.name;
	}

	function cancelRename() {
		editingBoardId = null;
		editingBoardName = '';
	}

	async function handlePickWorkspace() {
		if (!desktopRepo || workspaceBusy) return;
		workspaceBusy = true;
		workspaceError = null;
		try {
			const dir = await desktopRepo.pickWorkspaceDir();
			if (dir) {
				workspaceDir = dir;
				currentFilePath = desktopRepo.getCurrentFile()?.path ?? null;
				onUpdate?.(vm);
			}
		} catch (error) {
			workspaceError = describeError(error);
		} finally {
			workspaceBusy = false;
		}
	}

	async function handleClearWorkspace() {
		if (!desktopRepo || workspaceBusy) return;
		workspaceBusy = true;
		workspaceError = null;
		try {
			await desktopRepo.setWorkspaceDir(null);
			workspaceDir = null;
			onUpdate?.(vm);
		} catch (error) {
			workspaceError = describeError(error);
		} finally {
			workspaceBusy = false;
		}
	}
</script>

<Sheet bind:open onClose={closeBrowser} title="Boards" side="left" class="filebrowser-sheet">
	<!-- svelte-ignore a11y_autofocus -->
	<div class="filebrowser">
		<div class="filebrowser__header">
			<div class="filebrowser__title-row">
				<button
					class="filebrowser__close"
					type="button"
					onclick={closeBrowser}
					aria-label="Close board browser">
					<Icon name="close" size={20} color="var(--ink-danger)" />
				</button>
				<h2 class="filebrowser__title">Boards</h2>
			</div>
			{#if actionError}
				<div class="filebrowser__action-error" role="alert" aria-live="assertive">
					{actionError}
				</div>
			{/if}
			<button
				type="button"
				class="filebrowser__action filebrowser__action--create"
				onclick={() => {
					actionError = null;
					isCreating = true;
				}}
				disabled={actionBusy !== null}
				aria-label="Create new board">
				+ New
			</button>
		</div>

		<div class="filebrowser__summary" aria-label="Current board status">
			<div class="filebrowser__summary-heading">
				<span class="filebrowser__summary-label">Active board</span>
				<strong
					>{draft
						? 'Untitled draft'
						: (activeBoard?.name ?? 'No board selected')}</strong>
			</div>
			<dl class="filebrowser__summary-grid">
				<div>
					<dt>Storage</dt>
					<dd>{storageLabel()}</dd>
				</div>
				<div>
					<dt>Save state</dt>
					<dd
						class:filebrowser__summary-value--error={persistenceSnapshot?.state ===
							'error'}>
						{formatSaveState()}
					</dd>
				</div>
				<div>
					<dt>Location</dt>
					<dd title={storageLocation()}>{storageLocation()}</dd>
				</div>
				<div>
					<dt>Last updated</dt>
					<dd>
						{activeBoard ? formatTimestamp(activeBoard.updatedAt) : formatLastSaved()}
					</dd>
				</div>
			</dl>
		</div>

		{#if desktopRepo}
			<div class="filebrowser__workspace" aria-label="Board storage">
				<div class="filebrowser__workspace-modes" role="group" aria-label="Board source">
					<button
						type="button"
						class:is-active={Boolean(workspaceDir)}
						class="filebrowser__workspace-mode"
						onclick={handlePickWorkspace}
						disabled={workspaceBusy}
						aria-pressed={Boolean(workspaceDir)}>
						<Icon name="folder" size={16} />
						Workspace
					</button>
					<button
						type="button"
						class:is-active={!workspaceDir}
						class="filebrowser__workspace-mode"
						onclick={handleClearWorkspace}
						disabled={workspaceBusy}
						aria-pressed={!workspaceDir}>
						Recent files
					</button>
				</div>
				{#if workspaceDir}
					<div class="filebrowser__workspace-info">
						<span class="filebrowser__workspace-path" title={workspaceDir}>
							{workspaceDir.split(/[\\/]/).pop() || workspaceDir}
						</span>
						<button
							type="button"
							class="filebrowser__workspace-change"
							onclick={handlePickWorkspace}
							disabled={workspaceBusy}
							aria-label="Change workspace">
							Change
						</button>
					</div>
				{:else}
					<div class="filebrowser__workspace-hint">Showing boards opened recently.</div>
				{/if}
				{#if workspaceError}<p class="filebrowser__workspace-error" role="alert">
						{workspaceError}
					</p>{/if}
			</div>
		{/if}

		<div class="filebrowser__search">
			<input
				type="search"
				class="filebrowser__search-input"
				placeholder="Search boards..."
				bind:value={searchQuery}
				oninput={handleSearchInput}
				onchange={handleSearchChange}
				aria-label="Search boards" />
			<label class="filebrowser__sort">
				<span>Sort by</span>
				<select
					aria-label="Sort boards"
					value={vm.sort}
					onchange={(event) =>
						applySort((event.currentTarget as HTMLSelectElement).value)}>
					<option value="updated-desc">Last updated</option>
					<option value="created-desc">Date created</option>
					<option value="name-asc">Name A–Z</option>
					<option value="name-desc">Name Z–A</option>
				</select>
			</label>
		</div>

		{#if isCreating}
			<div class="filebrowser__create-form">
				<input
					type="text"
					class="filebrowser__input"
					placeholder="Board name"
					bind:value={newBoardName}
					aria-label="New board name"
					autofocus />
				<div class="filebrowser__create-actions">
					<Button
						class="filebrowser__btn filebrowser__btn--primary"
						variant="primary"
						size="small"
						busy={actionBusy === 'create'}
						disabled={actionBusy !== null}
						onclick={handleCreateBoard}>
						Create
					</Button>
					<Button
						class="filebrowser__btn filebrowser__btn--secondary"
						variant="secondary"
						size="small"
						onclick={() => {
							isCreating = false;
							newBoardName = '';
						}}>
						Cancel
					</Button>
				</div>
			</div>
		{/if}

		<div class="filebrowser__list" role="list" aria-label="Boards">
			{#if vm.filteredBoards.length === 0}
				<div class="filebrowser__empty">
					{vm.query ? 'No boards match your search' : 'No boards yet'}
				</div>
			{:else}
				{#each vm.filteredBoards as board (board.id)}
					<div
						class="filebrowser__board"
						class:filebrowser__board--selected={vm.selectedId === board.id}
						class:filebrowser__board--active={activeBoardId === board.id}
						role="listitem"
						aria-label={board.name}
						data-board-row={board.id}>
						{#if editingBoardId === board.id}
							<div class="filebrowser__edit-form">
								<input
									type="text"
									class="filebrowser__input"
									bind:value={editingBoardName}
									aria-label="Board name"
									autofocus />
								<div class="filebrowser__edit-actions">
									<button
										class="filebrowser__btn filebrowser__btn--primary"
										onclick={() => handleRenameBoard(board.id)}>
										Save
									</button>
									<button
										class="filebrowser__btn filebrowser__btn--secondary"
										onclick={cancelRename}>
										Cancel
									</button>
								</div>
							</div>
						{:else}
							<button
								type="button"
								class="filebrowser__board-info"
								data-board-id={board.id}
								id={board.id}
								disabled={actionBusy !== null}
								aria-busy={actionBusy === `open:${board.id}`}
								tabindex={vm.selectedId === board.id ? 0 : -1}
								onfocus={() => selectBoard(board.id)}
								onkeydown={(event) => handleBoardKeydown(event, board.id)}
								onclick={() => {
									selectBoard(board.id);
									void handleOpenBoard(board.id);
								}}
								aria-label={`Open ${board.name}`}>
								<span class="filebrowser__board-name">{board.name}</span>
								<span class="filebrowser__board-meta">
									{#if activeBoardId === board.id}<span
											class="filebrowser__board-badge">Open</span
										>{/if}
									Updated: {formatTimestamp(board.updatedAt)}
								</span>
							</button>
							<div class="filebrowser__board-actions">
								<button
									type="button"
									class="filebrowser__board-action"
									disabled={actionBusy !== null}
									onclick={() => handleInspectBoard(board)}
									aria-label="Inspect board"
									title={`Inspect ${board.name}`}>
									<Icon name="info-circle" size={16} />
								</button>
								<button
									type="button"
									class="filebrowser__board-action"
									disabled={actionBusy !== null}
									onclick={() => handleDuplicateBoard(board)}
									aria-label="Duplicate board"
									title={`Duplicate ${board.name}`}>
									<Icon name="copy" size={16} />
								</button>
								<button
									type="button"
									class="filebrowser__board-action"
									disabled={actionBusy !== null}
									onclick={() => startRename(board)}
									aria-label="Rename board"
									title={`Rename ${board.name}`}>
									<Icon name="pencil" size={16} />
								</button>
								<button
									type="button"
									class="filebrowser__board-action"
									disabled={actionBusy !== null}
									onclick={() => handleDeleteBoard(board.id)}
									aria-label="Delete board"
									title={`Delete ${board.name}`}>
									<Icon name="trash" size={16} />
								</button>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</Sheet>

<Sheet bind:open={inspectorOpen} title="Board Inspector" side="right">
	<div class="inspector">
		<div class="inspector__header">
			<h3 class="inspector__title">Board Inspector</h3>
			<button
				class="inspector__close"
				onclick={() => (inspectorOpen = false)}
				aria-label="Close inspector">
				<Icon name="close" size={20} color="var(--ink-danger)" />
			</button>
		</div>

		{#if inspectorLoading}
			<div class="inspector__loading">Loading...</div>
		{:else if inspectorError}
			<div class="inspector__error">{inspectorError}</div>
		{:else if inspectorData}
			<div class="inspector__content">
				{#if inspectorBoard}
					<section class="inspector__section">
						<h4 class="inspector__section-title">Board details</h4>
						<div class="inspector__item">
							<span class="inspector__label">Name:</span>
							<span class="inspector__value">{inspectorBoard.name}</span>
						</div>
						<div class="inspector__item">
							<span class="inspector__label">Created:</span>
							<span class="inspector__value"
								>{formatTimestamp(inspectorBoard.createdAt)}</span>
						</div>
						<div class="inspector__item">
							<span class="inspector__label">Last updated:</span>
							<span class="inspector__value"
								>{formatTimestamp(inspectorBoard.updatedAt)}</span>
						</div>
						<div class="inspector__item">
							<span class="inspector__label">Location:</span>
							<span class="inspector__value"
								>{inspectorBoard.storage?.location ?? 'Not available'}</span>
						</div>
					</section>
				{/if}

				<section class="inspector__section">
					<h4 class="inspector__section-title">Storage</h4>
					<div class="inspector__item">
						<span class="inspector__label">Storage Type:</span>
						<span class="inspector__value">{inspectorData.storageType}</span>
					</div>
				</section>

				<section class="inspector__section">
					<h4 class="inspector__section-title">Schema</h4>
					<div class="inspector__item">
						<span class="inspector__label">Declared Version:</span>
						<span class="inspector__value"
							>{inspectorData.schema.declaredVersion}</span>
					</div>
					<div class="inspector__item">
						<span class="inspector__label">Installed Version:</span>
						<span class="inspector__value"
							>{inspectorData.schema.installedVersion}</span>
					</div>
				</section>

				{#if inspectorData.document}
					<section class="inspector__section">
						<h4 class="inspector__section-title">Document</h4>
						<div class="inspector__item">
							<span class="inspector__label">Representation:</span>
							<span class="inspector__value"
								>{inspectorData.document.canonical
									? 'Canonical'
									: 'Materialized rows'}</span>
						</div>
						{#if inspectorData.document.documentId}
							<div class="inspector__item">
								<span class="inspector__label">Document ID:</span>
								<span class="inspector__value"
									>{inspectorData.document.documentId}</span>
							</div>
						{/if}
						{#if inspectorData.document.formatVersion !== undefined}
							<div class="inspector__item">
								<span class="inspector__label">Format Version:</span>
								<span class="inspector__value"
									>{inspectorData.document.formatVersion}</span>
							</div>
						{/if}
					</section>
				{/if}

				<section class="inspector__section">
					<h4 class="inspector__section-title">Statistics</h4>
					<div class="inspector__item">
						<span class="inspector__label">Pages:</span>
						<span class="inspector__value">{inspectorData.stats.pageCount}</span>
					</div>
					<div class="inspector__item">
						<span class="inspector__label">Shapes:</span>
						<span class="inspector__value">{inspectorData.stats.shapeCount}</span>
					</div>
					<div class="inspector__item">
						<span class="inspector__label">Bindings:</span>
						<span class="inspector__value">{inspectorData.stats.bindingCount}</span>
					</div>
					{#if inspectorData.stats.layerCount !== undefined}
						<div class="inspector__item">
							<span class="inspector__label">Layers:</span>
							<span class="inspector__value">{inspectorData.stats.layerCount}</span>
						</div>
					{/if}
					{#if inspectorData.stats.assetCount !== undefined}
						<div class="inspector__item">
							<span class="inspector__label">Assets:</span>
							<span class="inspector__value">{inspectorData.stats.assetCount}</span>
						</div>
					{/if}
					<div class="inspector__item">
						<span class="inspector__label">Doc Size:</span>
						<span class="inspector__value"
							>{BoardStatsOps.formatDocSize(inspectorData.stats.docSizeBytes)}</span>
					</div>
					<div class="inspector__item">
						<span class="inspector__label">Last Updated:</span>
						<span class="inspector__value">
							{formatTimestamp(inspectorData.stats.lastUpdated)}
						</span>
					</div>
				</section>
			</div>
		{/if}
	</div>
</Sheet>

<style>
	:global(.filebrowser-sheet) {
		padding: 0;
		width: min(520px, 100vw);
		max-width: 100vw;
	}

	.filebrowser {
		--filebrowser-divider: color-mix(in srgb, var(--ink-border) 42%, transparent);
		display: flex;
		flex-direction: column;
		height: 100%;
		background-color: var(--ink-canvas);
		color: var(--ink-text);
	}

	.filebrowser__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--ink-space-4);
		border-bottom: var(--ink-line-width) solid var(--filebrowser-divider);
	}

	.filebrowser__title-row {
		display: flex;
		align-items: center;
		gap: var(--ink-space-2);
	}

	.filebrowser__title {
		margin: 0;
		font-size: var(--ink-type-lg);
		font-weight: 650;
	}

	.filebrowser__action-error {
		flex: 1;
		margin: 0 var(--ink-space-2);
		color: var(--ink-danger);
		font-size: var(--ink-type-xs);
	}

	.filebrowser__summary {
		padding: var(--ink-space-3) var(--ink-space-4);
		border-bottom: var(--ink-line-width) solid var(--filebrowser-divider);
		background: var(--ink-surface);
	}

	.filebrowser__summary-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--ink-space-3);
		min-width: 0;
	}

	.filebrowser__summary-heading strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.filebrowser__summary-label,
	.filebrowser__summary-grid dt {
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.filebrowser__summary-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--ink-space-2) var(--ink-space-4);
		margin: var(--ink-space-3) 0 0;
	}

	.filebrowser__summary-grid div {
		min-width: 0;
	}

	.filebrowser__summary-grid dt,
	.filebrowser__summary-grid dd {
		margin: 0;
	}

	.filebrowser__summary-grid dd {
		overflow: hidden;
		color: var(--ink-text);
		font-size: var(--ink-type-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.filebrowser__summary-value--error {
		color: var(--ink-danger) !important;
	}
	.filebrowser__close {
		background: none;
		border: 1px solid transparent;
		color: var(--ink-text-muted);
		font-size: 1.5rem;
		cursor: pointer;
		padding: var(--ink-space-1);
		border-radius: var(--ink-radius-control-small);
		display: flex;
		align-items: center;
	}

	.filebrowser__close:hover,
	.filebrowser__close:focus-visible {
		background-color: var(--ink-surface-hover);
		color: var(--ink-text);
		border-color: var(--ink-danger);
	}

	.filebrowser__action {
		min-height: var(--ink-control-height);
		padding: 0 var(--ink-space-4);
		background-color: var(--ink-accent);
		color: var(--ink-on-accent);
		border: var(--ink-line-width) solid var(--ink-accent);
		border-radius: var(--ink-radius-control);
		cursor: pointer;
		font-size: var(--ink-type-sm);
		font-weight: 650;
	}

	.filebrowser__action:hover {
		background-color: var(--ink-accent-hover);
	}

	.filebrowser__action:disabled,
	.filebrowser__board-action:disabled,
	.filebrowser__board-info:disabled {
		cursor: wait;
		opacity: 0.6;
	}

	.filebrowser__workspace {
		padding: var(--ink-space-3) var(--ink-space-4);
		border-bottom: var(--ink-line-width) solid var(--ink-border);
		background-color: var(--ink-surface);
	}

	.filebrowser__workspace-modes {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--ink-space-1);
		padding: var(--ink-space-1);
		border: var(--ink-line-width) solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		background: var(--ink-canvas);
	}

	.filebrowser__workspace-mode {
		display: inline-flex;
		min-height: var(--ink-control-height-sm);
		align-items: center;
		justify-content: center;
		gap: var(--ink-space-1);
		padding: 0 var(--ink-space-2);
		border: 0;
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text-muted);
		background: transparent;
		cursor: pointer;
		font: inherit;
		font-size: var(--ink-type-xs);
	}

	.filebrowser__workspace-mode:hover:not(:disabled),
	.filebrowser__workspace-mode.is-active {
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.filebrowser__workspace-mode.is-active {
		box-shadow: inset 0 0 0 var(--ink-line-width) var(--ink-accent);
	}

	.filebrowser__workspace-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.filebrowser__workspace-path {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: monospace;
		color: var(--ink-text);
	}

	.filebrowser__workspace-change {
		min-height: var(--ink-control-height-sm);
		padding: 0 var(--ink-space-2);
		background-color: transparent;
		border: var(--ink-line-width) solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		cursor: pointer;
		font-size: var(--ink-type-xs);
		color: var(--ink-text);
	}

	.filebrowser__workspace-change:hover {
		background-color: var(--ink-surface-hover);
	}

	.filebrowser__workspace-hint {
		margin-top: var(--ink-space-2);
		font-size: var(--ink-type-xs);
		color: var(--ink-text-muted);
		text-align: center;
	}

	.filebrowser__workspace-error {
		margin: var(--ink-space-2) 0 0;
		color: var(--ink-danger);
		font-size: var(--ink-type-xs);
	}

	.filebrowser__search {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
		gap: var(--ink-space-2);
		padding: var(--ink-space-2) var(--ink-space-4);
		border-bottom: 1px solid var(--filebrowser-divider);
	}

	.filebrowser__search-input {
		width: 100%;
		min-height: var(--ink-control-height);
		padding: 0 var(--ink-space-2);
		border: var(--ink-line-width) solid color-mix(in srgb, var(--ink-border) 62%, transparent);
		border-radius: var(--ink-radius-control-small);
		font-size: var(--ink-type-sm);
		background-color: var(--ink-surface-raised);
		color: var(--ink-text);
	}

	.filebrowser__search-input:focus-visible {
		border-color: var(--ink-accent);
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	.filebrowser__sort {
		display: grid;
		gap: 0.25rem;
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
		font-weight: 650;
	}

	.filebrowser__sort select {
		min-height: var(--ink-control-height);
		max-width: 9.5rem;
		padding: 0 var(--ink-space-2);
		border: var(--ink-line-width) solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		background: var(--ink-surface-raised);
		color: var(--ink-text);
		font: inherit;
	}

	.filebrowser__sort select:focus-visible,
	.filebrowser__workspace-mode:focus-visible,
	.filebrowser__workspace-change:focus-visible {
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	.filebrowser__create-form,
	.filebrowser__edit-form {
		padding: 1rem;
		border-bottom: 1px solid var(--ink-border);
		background-color: var(--ink-surface-hover);
	}

	.filebrowser__input {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		font-size: 0.875rem;
		margin-bottom: 0.5rem;
		background-color: var(--ink-surface-raised);
		color: var(--ink-text);
	}

	.filebrowser__input:focus-visible {
		border-color: var(--ink-accent);
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	.filebrowser__create-actions,
	.filebrowser__edit-actions {
		display: flex;
		gap: 0.5rem;
	}

	.filebrowser__btn {
		min-height: var(--ink-control-height-sm);
		padding: 0 var(--ink-space-3);
		border: var(--ink-line-width) solid transparent;
		border-radius: var(--ink-radius-control-small);
		cursor: pointer;
		font-size: var(--ink-type-sm);
	}

	.filebrowser__btn--primary {
		background-color: var(--ink-accent);
		color: var(--ink-on-accent);
	}

	.filebrowser__btn--primary:hover {
		background-color: var(--ink-accent-hover);
	}

	.filebrowser__btn--secondary {
		background-color: var(--ink-surface);
		color: var(--ink-text);
	}

	.filebrowser__btn--secondary:hover {
		background-color: var(--ink-surface-hover);
	}

	.filebrowser__list {
		flex: 1;
		overflow-y: auto;
	}

	.filebrowser__empty {
		padding: 2rem;
		text-align: center;
		color: var(--ink-text-muted);
	}

	.filebrowser__board {
		display: flex;
		align-items: center;
		gap: var(--ink-space-2);
		padding: var(--ink-space-2) var(--ink-space-4);
		border-bottom: 1px solid var(--filebrowser-divider);
		transition: background-color var(--ink-duration-fast) var(--ink-ease-out);
	}

	.filebrowser__board:hover,
	.filebrowser__board--selected {
		background-color: color-mix(in srgb, var(--ink-surface-hover) 72%, transparent);
	}

	.filebrowser__board--active {
		box-shadow: inset 3px 0 0 var(--ink-accent);
	}

	.filebrowser__board-info {
		display: grid;
		flex: 1;
		min-width: 0;
		gap: 0.25rem;
		padding: var(--ink-space-2) 0;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
		font: inherit;
		text-align: left;
	}

	.filebrowser__board-info:focus-visible {
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	.filebrowser__board-name {
		overflow: hidden;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.filebrowser__board-meta {
		display: flex;
		align-items: center;
		gap: var(--ink-space-2);
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
	}

	.filebrowser__board-badge {
		padding: 0.125rem 0.375rem;
		border-radius: 999px;
		color: var(--ink-accent);
		background: color-mix(in srgb, var(--ink-accent) 14%, transparent);
		font-weight: 650;
	}

	.filebrowser__board-actions {
		display: flex;
		flex: 0 0 auto;
		gap: var(--ink-space-1);
	}

	.filebrowser__board-action {
		display: grid;
		width: var(--ink-control-height-sm);
		height: var(--ink-control-height-sm);
		place-items: center;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--ink-radius-control-small);
		background: transparent;
		color: var(--ink-text-muted);
		cursor: pointer;
	}

	.filebrowser__board-action:hover:not(:disabled),
	.filebrowser__board-action:focus-visible {
		border-color: var(--ink-border);
		background: var(--ink-surface-hover);
		color: var(--ink-text);
	}

	.filebrowser__board-action:focus-visible {
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	/* Inspector styles */
	.inspector {
		display: flex;
		flex-direction: column;
		height: 100%;
		background-color: var(--ink-canvas);
		color: var(--ink-text);
	}

	.inspector__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
		border-bottom: 1px solid var(--ink-border);
	}

	.inspector__title {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.inspector__close {
		background: transparent;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--ink-radius-control-small);
		transition: background-color 0.15s;
	}

	.inspector__close:hover {
		background-color: var(--ink-surface-hover);
	}

	.inspector__loading {
		padding: 2rem;
		text-align: center;
		color: var(--ink-text-muted);
	}

	.inspector__error {
		padding: 1rem;
		margin: 1rem;
		background-color: var(--ink-danger-surface);
		color: var(--ink-danger);
		border-radius: var(--ink-radius-control-small);
		border: 1px solid var(--ink-danger);
	}

	.inspector__content {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.inspector__section {
		margin-bottom: 1.5rem;
	}

	.inspector__section-title {
		margin: 0 0 0.75rem 0;
		font-size: 0.875rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--ink-text-muted);
	}

	.inspector__item {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--ink-border);
	}

	.inspector__label {
		font-weight: 500;
		color: var(--ink-text);
	}

	.inspector__value {
		color: var(--ink-text-muted);
	}

	@media (max-width: 560px) {
		:global(.filebrowser-sheet) {
			width: 100vw;
		}

		.filebrowser__header {
			padding: var(--ink-space-3);
		}

		.filebrowser__summary,
		.filebrowser__workspace,
		.filebrowser__search {
			padding-inline: var(--ink-space-3);
		}

		.filebrowser__summary-grid {
			gap: var(--ink-space-2);
		}

		.filebrowser__search {
			grid-template-columns: 1fr;
		}

		.filebrowser__sort select {
			width: 100%;
			max-width: none;
		}

		.filebrowser__board {
			padding-inline: var(--ink-space-3);
		}
	}

	@media (pointer: coarse) {
		.filebrowser__close,
		.filebrowser__board-action {
			min-width: 2.75rem;
			min-height: 2.75rem;
		}

		.filebrowser__workspace-mode,
		.filebrowser__workspace-change {
			min-height: 2.75rem;
		}
	}
</style>
