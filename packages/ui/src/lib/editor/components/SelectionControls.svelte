<script lang="ts">
	import '../../styles/components/selection-controls.css';
	import type { EditorState as EditorStateType, Store, ToolId } from '@inkfinite/core';
	import { untrack } from 'svelte';
	import { Icon, IconButton } from '../../index';
	import SelectionAppearance from './SelectionAppearance.svelte';
	import SelectionContainer from './SelectionContainer.svelte';
	import SelectionEffects from './SelectionEffects.svelte';
	import SelectionImage from './SelectionImage.svelte';
	import SelectionMetadata from './SelectionMetadata.svelte';
	import SelectionPathVector from './SelectionPathVector.svelte';
	import SelectionText from './SelectionText.svelte';
	import SelectionTransform from './SelectionTransform.svelte';
	import { getSelectionInspectorState } from '../selection-inspector';

	type Props = {
		currentTool: ToolId;
		store: Store;
		orientation: 'vertical' | 'horizontal';
		/** Whether to expose the desktop-only agent editability control. */
		showAgentControl?: boolean;
		onEnterFrame?: (frameId: string) => void;
		onFitSelection?: () => void;
	};

	let {
		currentTool,
		store,
		orientation,
		showAgentControl = false,
		onEnterFrame,
		onFitSelection
	}: Props = $props();

	let editorState = $state<EditorStateType>(untrack(() => store.getState()));
	let collapsed = $state(false);
	let sectionsViewport = $state<HTMLDivElement | undefined>();
	let canScrollSectionsBack = $state(false);
	let canScrollSectionsForward = $state(false);
	let selection = $derived(getSelectionInspectorState(editorState));
	let showContextControls = $derived(currentTool !== 'pen' && selection.selectionCount > 0);

	$effect(() => {
		const unsubscribe = store.subscribe((state) => (editorState = state));
		return unsubscribe;
	});

	function updateSectionsScrollState() {
		if (!sectionsViewport) return;
		canScrollSectionsBack = sectionsViewport.scrollLeft > 1;
		canScrollSectionsForward =
			sectionsViewport.scrollLeft + sectionsViewport.clientWidth <
			sectionsViewport.scrollWidth - 1;
	}

	function shiftSections(direction: -1 | 1) {
		if (!sectionsViewport) return;
		const sections = Array.from(
			sectionsViewport.querySelectorAll<HTMLElement>(':scope > .selection-controls__section')
		);
		const current = sectionsViewport.scrollLeft;
		const target =
			direction > 0
				? sections.find((section) => section.offsetLeft > current + 1)
				: sections.filter((section) => section.offsetLeft < current - 1).at(-1);
		sectionsViewport.scrollTo({
			left: target?.offsetLeft ?? (direction > 0 ? sectionsViewport.scrollWidth : 0),
			behavior: 'smooth'
		});
	}

	$effect(() => {
		selection.selectionCount;
		queueMicrotask(updateSectionsScrollState);
	});

	$effect(() => {
		if (!sectionsViewport) return;
		const observer = new ResizeObserver(updateSectionsScrollState);
		observer.observe(sectionsViewport);
		for (const child of sectionsViewport.children) observer.observe(child);
		updateSectionsScrollState();
		return () => observer.disconnect();
	});
</script>

{#if showContextControls}
	<div
		class="selection-controls"
		class:selection-controls--horizontal={orientation === 'horizontal'}
		class:selection-controls--collapsed={collapsed}
		role="toolbar"
		aria-label="Selection controls"
		data-agent-occlusion>
		<header class="selection-controls__header">
			<strong
				>{selection.selectionCount}
				{selection.selectionCount === 1 ? 'object' : 'objects'} selected</strong>
			<IconButton
				label={collapsed ? 'Expand contextual actions' : 'Collapse contextual actions'}
				name={collapsed ? 'chevron-down' : 'chevron-up'}
				onclick={() => (collapsed = !collapsed)} />
		</header>

		{#if !collapsed}
			<div
				bind:this={sectionsViewport}
				class="selection-controls__sections"
				onscroll={updateSectionsScrollState}>
				<SelectionAppearance {store} {selection} />
				<SelectionMetadata {store} {selection} />
				<SelectionImage {store} {selection} />
				<SelectionContainer {store} {selection} {onEnterFrame} {onFitSelection} />
				<SelectionText {store} {selection} />
				<SelectionPathVector {store} {selection} />
				<SelectionEffects {store} {selection} />
				<SelectionTransform {store} {selection} {showAgentControl} />
			</div>

			<div
				class="selection-controls__scroll-actions"
				aria-label="Browse contextual controls">
				<button
					aria-label="Show previous contextual controls"
					disabled={!canScrollSectionsBack}
					onclick={() => shiftSections(-1)}
					><Icon name="chevron-left" size={16} /></button>
				<button
					aria-label="Show more contextual controls"
					disabled={!canScrollSectionsForward}
					onclick={() => shiftSections(1)}
					><Icon name="chevron-right" size={16} /></button>
			</div>
		{/if}
	</div>
{/if}
