<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import type { DesktopDocRepo } from '$lib/persistence/desktop';
	import type {
		BoardInspectorData,
		BoardMeta,
		FileBrowserViewModel,
		InkfiniteDB
	} from 'inkfinite-core';
	import { BoardStatsOps, FileBrowserVM } from 'inkfinite-core';
	import type { Snippet } from 'svelte';

	type Props = {
		vm: FileBrowserViewModel;
		onUpdate?: (vm: FileBrowserViewModel) => void;
		fetchInspectorData?: (
			boardId: string,
			webDb: InkfiniteDB | null
		) => Promise<BoardInspectorData>;
		open?: boolean;
		onClose?: () => void;
		children?: Snippet;
		desktopRepo?: DesktopDocRepo | null;
	};

	let {
		vm = $bindable(),
		onUpdate,
		fetchInspectorData,
		open = $bindable(false),
		onClose: handleClose,
		children: _children,
		desktopRepo = null
	}: Props = $props();

	let searchQuery = $derived(vm.query);
	let inspectorOpen = $state(false);
	let inspectorData = $state<BoardInspectorData | null>(null);
	let inspectorLoading = $state(false);
	let inspectorError = $state<string | null>(null);

	let isCreating = $state(false);
	let newBoardName = $state('');
	let editingBoardId = $state<string | null>(null);
	let editingBoardName = $state('');

	let workspaceDir = $state<string | null>(null);

	$effect(() => {
		if (desktopRepo && open) {
			desktopRepo.getWorkspaceDir().then((dir) => {
				workspaceDir = dir;
			});
		}
	});

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

	function closeBrowser() {
		open = false;
		handleClose?.();
	}

	async function handleOpenBoard(boardId: string) {
		try {
			await vm.actions.open(boardId);
			closeBrowser();
		} catch (error) {
			console.error('Failed to open board:', error);
		}
	}

	async function handleCreateBoard() {
		if (!newBoardName.trim()) return;
		try {
			const boardId = await vm.actions.create(newBoardName);
			isCreating = false;
			newBoardName = '';
			onUpdate?.(vm);
			await handleOpenBoard(boardId);
		} catch (error) {
			console.error('Failed to create board:', error);
		}
	}

	async function handleRenameBoard(boardId: string) {
		if (!editingBoardName.trim()) return;
		try {
			await vm.actions.rename(boardId, editingBoardName);
			editingBoardId = null;
			editingBoardName = '';
			onUpdate?.(vm);
		} catch (error) {
			console.error('Failed to rename board:', error);
		}
	}

	async function handleDeleteBoard(boardId: string) {
		if (!confirm('Are you sure you want to delete this board? This action cannot be undone.')) {
			return;
		}
		try {
			await vm.actions.delete(boardId);
			if (inspectorOpen && vm.selectedId === boardId) {
				inspectorOpen = false;
				inspectorData = null;
			}
			onUpdate?.(vm);
		} catch (error) {
			console.error('Failed to delete board:', error);
		}
	}

	async function handleInspectBoard(board: BoardMeta) {
		if (!fetchInspectorData) {
			console.warn('Inspector data fetcher not provided');
			return;
		}

		inspectorOpen = true;
		inspectorLoading = true;
		inspectorError = null;

		try {
			inspectorData = await fetchInspectorData(board.id, null);
		} catch (error) {
			inspectorError = error instanceof Error ? error.message : 'Failed to load inspector data';
			inspectorData = null;
		} finally {
			inspectorLoading = false;
		}
	}

	function formatTimestamp(timestamp: number): string {
		return new Date(timestamp).toLocaleString();
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
		if (!desktopRepo) return;
		try {
			const dir = await desktopRepo.pickWorkspaceDir();
			if (dir) {
				workspaceDir = dir;
				onUpdate?.(vm);
			}
		} catch (error) {
			console.error('Failed to pick workspace:', error);
		}
	}

	async function handleClearWorkspace() {
		if (!desktopRepo) return;
		try {
			await desktopRepo.setWorkspaceDir(null);
			workspaceDir = null;
			onUpdate?.(vm);
		} catch (error) {
			console.error('Failed to clear workspace:', error);
		}
	}
</script>

<Sheet bind:open onClose={closeBrowser} title="Boards" side="left" class="filebrowser-sheet">
	<!-- svelte-ignore a11y_autofocus -->
	<div class="filebrowser">
		<div class="filebrowser__header">
			<div class="filebrowser__title-row">
				<h2 class="filebrowser__title">Boards</h2>
				<button
					class="filebrowser__close"
					type="button"
					onclick={closeBrowser}
					aria-label="Close board browser">
					<Icon name="close" size={20} color="#e27878" />
				</button>
			</div>
			<button
				class="filebrowser__action filebrowser__action--create"
				onclick={() => (isCreating = true)}
				aria-label="Create new board">
				+ New
			</button>
		</div>

		{#if desktopRepo}
			<div class="filebrowser__workspace">
				{#if workspaceDir}
					<div class="filebrowser__workspace-info">
						<Icon name="folder" size={16} />
						<span class="filebrowser__workspace-path" title={workspaceDir}>
							{workspaceDir.split('/').pop() || workspaceDir}
						</span>
						<button
							class="filebrowser__workspace-change"
							onclick={handlePickWorkspace}
							aria-label="Change workspace">
							Change
						</button>
						<button
							class="filebrowser__workspace-clear"
							onclick={handleClearWorkspace}
							aria-label="Clear workspace">
							×
						</button>
					</div>
				{:else}
					<button
						class="filebrowser__workspace-pick"
						onclick={handlePickWorkspace}
						aria-label="Pick workspace folder">
						<Icon name="folder" size={16} />
						Pick Workspace Folder
					</button>
					<div class="filebrowser__workspace-hint">Recent files mode</div>
				{/if}
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
					<button class="filebrowser__btn filebrowser__btn--primary" onclick={handleCreateBoard}>
						Create
					</button>
					<button
						class="filebrowser__btn filebrowser__btn--secondary"
						onclick={() => {
							isCreating = false;
							newBoardName = '';
						}}>
						Cancel
					</button>
				</div>
			</div>
		{/if}

		<div class="filebrowser__list">
			{#if vm.filteredBoards.length === 0}
				<div class="filebrowser__empty">
					{vm.query ? 'No boards match your search' : 'No boards yet'}
				</div>
			{:else}
				{#each vm.filteredBoards as board (board.id)}
					<div class="filebrowser__board">
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
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="filebrowser__board-info" onclick={() => handleOpenBoard(board.id)}>
								<div class="filebrowser__board-name">{board.name}</div>
								<div class="filebrowser__board-meta">
									Updated: {formatTimestamp(board.updatedAt)}
								</div>
							</div>
							<div class="filebrowser__board-actions">
								<button
									class="filebrowser__board-action"
									onclick={(e) => {
										e.stopPropagation();
										handleInspectBoard(board);
									}}
									aria-label="Inspect board">
									<Icon name="info-circle" size={16} />
								</button>
								<button
									class="filebrowser__board-action"
									onclick={(e) => {
										e.stopPropagation();
										startRename(board);
									}}
									aria-label="Rename board">
									<Icon name="pencil" size={16} />
								</button>
								<button
									class="filebrowser__board-action"
									onclick={(e) => {
										e.stopPropagation();
										handleDeleteBoard(board.id);
									}}
									aria-label="Delete board">
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
				<Icon name="close" size={20} color="#e27878" />
			</button>
		</div>

		{#if inspectorLoading}
			<div class="inspector__loading">Loading...</div>
		{:else if inspectorError}
			<div class="inspector__error">{inspectorError}</div>
		{:else if inspectorData}
			<div class="inspector__content">
				<section class="inspector__section">
					<h4 class="inspector__section-title">Storage</h4>
					<div class="inspector__item">
						<span class="inspector__label">Storage Type:</span>
						<!-- TODO: local? browser? -->
						<span class="inspector__value">IndexedDB (Dexie)</span>
					</div>
				</section>

				<section class="inspector__section">
					<h4 class="inspector__section-title">Schema</h4>
					<div class="inspector__item">
						<span class="inspector__label">Declared Version:</span>
						<span class="inspector__value">{inspectorData.schema.declaredVersion}</span>
					</div>
					<div class="inspector__item">
						<span class="inspector__label">Installed Version:</span>
						<span class="inspector__value">{inspectorData.schema.installedVersion}</span>
					</div>
				</section>

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

				<section class="inspector__section">
					<h4 class="inspector__section-title">Migrations</h4>
					{#if inspectorData.migrations.length === 0}
						<div class="inspector__empty">No migrations applied yet</div>
					{:else}
						<div class="inspector__migrations">
							{#each inspectorData.migrations as migration (migration.id)}
								<div class="inspector__migration">
									<span class="inspector__migration-id">{migration.id}</span>
									<span class="inspector__migration-date">
										{formatTimestamp(migration.appliedAt)}
									</span>
								</div>
							{/each}
						</div>
					{/if}
					{#if inspectorData.pendingMigrations.length > 0}
						<div class="inspector__pending">
							<h5 class="inspector__pending-title">Pending Migrations:</h5>
							{#each inspectorData.pendingMigrations as migrationId (migrationId)}
								<div class="inspector__pending-migration">{migrationId}</div>
							{/each}
						</div>
					{/if}
				</section>
			</div>
		{/if}
	</div>
</Sheet>

<style>
	:global(.filebrowser-sheet) {
		padding: 0;
		width: min(520px, 90vw);
	}

	.filebrowser {
		display: flex;
		flex-direction: column;
		height: 100%;
		background-color: var(--surface);
		color: var(--text);
	}

	.filebrowser__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
		border-bottom: 1px solid var(--border, #e0e0e0);
	}

	.filebrowser__title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.filebrowser__title {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.filebrowser__close {
		background: none;
		border: 1px solid transparent;
		color: var(--text-secondary, #666);
		font-size: 1.5rem;
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
	}

	.filebrowser__close:hover,
	.filebrowser__close:focus-visible {
		background-color: rgba(0, 0, 0, 0.05);
		color: var(--text);
		border: 1px solid #e27878;
	}

	.filebrowser__action {
		padding: 0.5rem 1rem;
		background-color: var(--primary, #007bff);
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.filebrowser__action:hover {
		background-color: var(--primary-hover, #0056b3);
	}

	.filebrowser__workspace {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border, #e0e0e0);
		background-color: var(--surface-secondary, #f9f9f9);
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
		color: var(--text);
	}

	.filebrowser__workspace-change,
	.filebrowser__workspace-clear {
		padding: 0.25rem 0.5rem;
		background-color: transparent;
		border: 1px solid var(--border, #e0e0e0);
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.75rem;
		color: var(--text);
	}

	.filebrowser__workspace-change:hover,
	.filebrowser__workspace-clear:hover {
		background-color: var(--surface-hover, #f5f5f5);
	}

	.filebrowser__workspace-pick {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem;
		background-color: var(--primary, #007bff);
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.filebrowser__workspace-pick:hover {
		background-color: var(--primary-hover, #0056b3);
	}

	.filebrowser__workspace-hint {
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: var(--text-muted, #6c757d);
		text-align: center;
	}

	.filebrowser__search {
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--border, #e0e0e0);
	}

	.filebrowser__search-input {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--border, #e0e0e0);
		border-radius: 4px;
		font-size: 0.875rem;
		background-color: var(--input-bg, white);
		color: var(--text);
	}

	.filebrowser__search-input:focus {
		outline: none;
		border-color: var(--primary, #007bff);
	}

	.filebrowser__create-form,
	.filebrowser__edit-form {
		padding: 1rem;
		border-bottom: 1px solid var(--border, #e0e0e0);
		background-color: var(--surface-hover, #f5f5f5);
	}

	.filebrowser__input {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--border, #e0e0e0);
		border-radius: 4px;
		font-size: 0.875rem;
		margin-bottom: 0.5rem;
		background-color: var(--input-bg, white);
		color: var(--text);
	}

	.filebrowser__input:focus {
		outline: none;
		border-color: var(--primary, #007bff);
	}

	.filebrowser__create-actions,
	.filebrowser__edit-actions {
		display: flex;
		gap: 0.5rem;
	}

	.filebrowser__btn {
		padding: 0.375rem 0.75rem;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.filebrowser__btn--primary {
		background-color: var(--primary, #007bff);
		color: white;
	}

	.filebrowser__btn--primary:hover {
		background-color: var(--primary-hover, #0056b3);
	}

	.filebrowser__btn--secondary {
		background-color: var(--secondary, #6c757d);
		color: white;
	}

	.filebrowser__btn--secondary:hover {
		background-color: var(--secondary-hover, #5a6268);
	}

	.filebrowser__list {
		flex: 1;
		overflow-y: auto;
	}

	.filebrowser__empty {
		padding: 2rem;
		text-align: center;
		color: var(--text-muted, #6c757d);
	}

	.filebrowser__board {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border, #e0e0e0);
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.filebrowser__board:hover {
		background-color: var(--surface-hover, #f5f5f5);
	}

	.filebrowser__board-info {
		flex: 1;
	}

	.filebrowser__board-name {
		font-weight: 500;
		margin-bottom: 0.25rem;
	}

	.filebrowser__board-meta {
		font-size: 0.75rem;
		color: var(--text-muted, #6c757d);
	}

	.filebrowser__board-actions {
		display: flex;
		gap: 0.5rem;
	}

	.filebrowser__board-action {
		padding: 0.25rem 0.5rem;
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		opacity: 0.7;
		transition: opacity 0.15s;
	}

	.filebrowser__board-action:hover {
		opacity: 1;
	}

	/* Inspector styles */
	.inspector {
		display: flex;
		flex-direction: column;
		height: 100%;
		background-color: var(--surface);
		color: var(--text);
	}

	.inspector__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
		border-bottom: 1px solid var(--border, #e0e0e0);
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
		border-radius: 4px;
		transition: background-color 0.15s;
	}

	.inspector__close:hover {
		background-color: var(--surface-hover, #f5f5f5);
	}

	.inspector__loading {
		padding: 2rem;
		text-align: center;
		color: var(--text-muted, #6c757d);
	}

	.inspector__error {
		padding: 1rem;
		margin: 1rem;
		background-color: var(--error-bg, #f8d7da);
		color: var(--error-text, #721c24);
		border-radius: 4px;
		border: 1px solid var(--error-border, #f5c6cb);
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
		color: var(--text-muted, #6c757d);
	}

	.inspector__item {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border-light, #f0f0f0);
	}

	.inspector__label {
		font-weight: 500;
		color: var(--text);
	}

	.inspector__value {
		color: var(--text-muted, #6c757d);
	}

	.inspector__empty {
		padding: 1rem;
		text-align: center;
		color: var(--text-muted, #6c757d);
		font-size: 0.875rem;
	}

	.inspector__migrations {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.inspector__migration {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem;
		background-color: var(--surface-hover, #f5f5f5);
		border-radius: 4px;
	}

	.inspector__migration-id {
		font-weight: 500;
		font-family: monospace;
	}

	.inspector__migration-date {
		font-size: 0.75rem;
		color: var(--text-muted, #6c757d);
	}

	.inspector__pending {
		margin-top: 1rem;
		padding: 0.75rem;
		background-color: var(--warning-bg, #fff3cd);
		border: 1px solid var(--warning-border, #ffeaa7);
		border-radius: 4px;
	}

	.inspector__pending-title {
		margin: 0 0 0.5rem 0;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--warning-text, #856404);
	}

	.inspector__pending-migration {
		font-family: monospace;
		font-size: 0.875rem;
		padding: 0.25rem 0;
		color: var(--warning-text, #856404);
	}
</style>
