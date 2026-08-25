<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import { ContextMenu, Icon, type ContextMenuEntry } from '../../index';
	import {
		executeSelectionCommand,
		SELECTION_COMMAND_LABELS,
		type SelectionCommand
	} from '../commands';
	import type { SelectionInspectorState } from '../selection-inspector';

	type Props = { store: Store; selection: SelectionInspectorState; showAgentControl?: boolean };
	let { store, selection, showAgentControl = false }: Props = $props();
	let layoutMenuOpen = $state(false);
	let layoutMenuMode = $state<'align' | 'arrange'>('arrange');
	let layoutMenuPoint = $state({ x: 0, y: 0 });
	let layoutMenuReturnFocus = $state<HTMLButtonElement | null>(null);
	let agentInputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (!agentInputEl) return;
		agentInputEl.checked = selection.agentEditableState.value;
		agentInputEl.indeterminate = selection.agentEditableState.mixed;
	});

	function toggleLayoutMenu(mode: 'align' | 'arrange', button: HTMLButtonElement) {
		if (layoutMenuOpen && layoutMenuMode === mode) {
			layoutMenuOpen = false;
			return;
		}
		const bounds = button.getBoundingClientRect();
		layoutMenuMode = mode;
		layoutMenuReturnFocus = button;
		layoutMenuPoint = { x: bounds.left, y: bounds.bottom + 8 };
		layoutMenuOpen = true;
	}

	function layoutMenuItems(mode: 'align' | 'arrange'): ContextMenuEntry[] {
		if (mode === 'align') {
			return (
				[
					'align-left',
					'align-center',
					'align-right',
					'align-top',
					'align-middle',
					'align-bottom'
				] as SelectionCommand[]
			).map((id) => ({ id, label: SELECTION_COMMAND_LABELS[id], icon: 'select' as const }));
		}
		return [
			{
				id: 'distribute-horizontal',
				label: SELECTION_COMMAND_LABELS['distribute-horizontal'],
				icon: 'arrow-right',
				disabled: selection.selectionCount < 3
			},
			{
				id: 'distribute-vertical',
				label: SELECTION_COMMAND_LABELS['distribute-vertical'],
				icon: 'arrow-down',
				disabled: selection.selectionCount < 3
			},
			{
				id: 'arrange-grid',
				label: SELECTION_COMMAND_LABELS['arrange-grid'],
				icon: 'grid-dots',
				disabled: selection.selectionCount < 2
			},
			{
				id: 'tidy',
				label: SELECTION_COMMAND_LABELS.tidy,
				icon: 'grid-dots',
				disabled: selection.selectionCount < 2
			},
			{ type: 'separator' },
			{
				id: 'graph-flow-top-to-bottom',
				label: SELECTION_COMMAND_LABELS['graph-flow-top-to-bottom'],
				icon: 'arrow-down',
				disabled: selection.selectionCount < 2
			},
			{
				id: 'graph-flow-left-to-right',
				label: SELECTION_COMMAND_LABELS['graph-flow-left-to-right'],
				icon: 'arrow-right',
				disabled: selection.selectionCount < 2
			},
			{
				id: 'graph-tree-top-to-bottom',
				label: SELECTION_COMMAND_LABELS['graph-tree-top-to-bottom'],
				icon: 'arrow-down',
				disabled: selection.selectionCount < 2
			},
			{
				id: 'graph-tree-left-to-right',
				label: SELECTION_COMMAND_LABELS['graph-tree-left-to-right'],
				icon: 'arrow-right',
				disabled: selection.selectionCount < 2
			},
			{
				id: 'graph-radial',
				label: SELECTION_COMMAND_LABELS['graph-radial'],
				icon: 'select',
				disabled: selection.selectionCount < 2
			},
			{ type: 'separator' },
			{
				id: 'stack-horizontal',
				label: SELECTION_COMMAND_LABELS['stack-horizontal'],
				icon: 'arrow-right',
				disabled: selection.selectionCount < 2
			},
			{
				id: 'stack-vertical',
				label: SELECTION_COMMAND_LABELS['stack-vertical'],
				icon: 'arrow-down',
				disabled: selection.selectionCount < 2
			},
			{ type: 'separator' },
			{
				id: 'group',
				label: SELECTION_COMMAND_LABELS.group,
				icon: 'layers',
				disabled: selection.selectionCount < 2
			},
			{
				id: 'ungroup',
				label: SELECTION_COMMAND_LABELS.ungroup,
				icon: 'layers',
				disabled: !selection.hasGroupedSelection
			},
			{ type: 'separator' },
			{
				id: 'convert-to-rect',
				label: SELECTION_COMMAND_LABELS['convert-to-rect'],
				icon: 'rectangle',
				disabled: selection.selectionCount === 0
			},
			{
				id: 'convert-to-ellipse',
				label: SELECTION_COMMAND_LABELS['convert-to-ellipse'],
				icon: 'ellipse',
				disabled: selection.selectionCount === 0
			},
			{ type: 'separator' },
			{
				id: 'forward',
				label: SELECTION_COMMAND_LABELS.forward,
				icon: 'arrow-up',
				shortcut: '⌘/Ctrl ]'
			},
			{
				id: 'backward',
				label: SELECTION_COMMAND_LABELS.backward,
				icon: 'arrow-down',
				shortcut: '⌘/Ctrl ['
			},
			{
				id: 'front',
				label: SELECTION_COMMAND_LABELS.front,
				icon: 'arrow-up',
				shortcut: '⇧⌘/Ctrl ]'
			},
			{
				id: 'back',
				label: SELECTION_COMMAND_LABELS.back,
				icon: 'arrow-down',
				shortcut: '⇧⌘/Ctrl ['
			},
			{ type: 'separator' },
			{
				id: selection.allSelectedLocked ? 'unlock' : 'lock',
				label: selection.allSelectedLocked
					? SELECTION_COMMAND_LABELS.unlock
					: SELECTION_COMMAND_LABELS.lock,
				icon: selection.allSelectedLocked ? 'lock-open' : 'lock',
				shortcut: '⇧⌘/Ctrl L'
			}
		];
	}

	function handleMenuAction(id: string) {
		if (id in SELECTION_COMMAND_LABELS) executeSelectionCommand(store, id as SelectionCommand);
	}

	function handleAgentEditable(event: Event) {
		executeSelectionCommand(
			store,
			(event.currentTarget as HTMLInputElement).checked ? 'agent-editable' : 'agent-readonly'
		);
	}
</script>

{#if selection.selectionCount >= 2}
	<section class="selection-controls__section" aria-labelledby="selection-layout-label">
		<h2 id="selection-layout-label">Arrange selection</h2>
		<div class="selection-controls__actions">
			<button
				class="selection-controls__action"
				type="button"
				onclick={(event) =>
					toggleLayoutMenu('align', event.currentTarget as HTMLButtonElement)}
				aria-haspopup="menu"
				aria-expanded={layoutMenuOpen && layoutMenuMode === 'align'}
				><Icon name="select" size={15} /><span>Align</span></button>
			<button
				class="selection-controls__action"
				type="button"
				onclick={(event) =>
					toggleLayoutMenu('arrange', event.currentTarget as HTMLButtonElement)}
				aria-haspopup="menu"
				aria-expanded={layoutMenuOpen && layoutMenuMode === 'arrange'}
				><Icon name="settings" size={15} /><span>Arrange</span></button>
		</div>
	</section>
{/if}

<section
	class="selection-controls__section selection-controls__section--actions"
	aria-labelledby="selection-actions-label">
	<h2 id="selection-actions-label">Selection</h2>
	<div class="selection-controls__actions">
		{#if selection.selectionCount >= 2}<button
				class="selection-controls__action"
				type="button"
				onclick={() => executeSelectionCommand(store, 'group')}
				aria-label="Group selected objects"
				><Icon name="layers" size={15} /><span>Group</span></button
			>{/if}
		<button
			class="selection-controls__action"
			type="button"
			onclick={() =>
				executeSelectionCommand(store, selection.allSelectedLocked ? 'unlock' : 'lock')}
			aria-label={selection.allSelectedLocked
				? 'Unlock selected objects'
				: 'Lock selected objects'}
			><Icon name={selection.allSelectedLocked ? 'lock-open' : 'lock'} size={15} /><span
				>{selection.allSelectedLocked ? 'Unlock' : 'Lock'}</span
			></button>
		{#if showAgentControl}<label
				class="selection-controls__agent-control"
				title="Allow agents to edit the selection"
				><input
					bind:this={agentInputEl}
					type="checkbox"
					checked={selection.agentEditableState.value}
					onchange={handleAgentEditable}
					aria-label="Agent editable" /><span>Agents</span></label
			>{/if}
	</div>
</section>

<ContextMenu
	items={layoutMenuItems(layoutMenuMode)}
	compact={layoutMenuMode === 'arrange'}
	label={layoutMenuMode === 'align' ? 'Alignment commands' : 'Arrange commands'}
	open={layoutMenuOpen}
	returnFocus={layoutMenuReturnFocus}
	x={layoutMenuPoint.x}
	y={layoutMenuPoint.y}
	onOpenChange={(value) => (layoutMenuOpen = value)}
	onSelect={handleMenuAction} />
