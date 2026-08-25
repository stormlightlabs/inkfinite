<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import { executeEditorStateCommand } from '../commands';
	import {
		filterPresetForShape,
		setSelectedFilterPreset,
		setSelectedMaskMode
	} from '@inkfinite/core';
	import type { SelectionInspectorState } from '../selection-inspector';

	let { store, selection }: { store: Store; selection: SelectionInspectorState } = $props();

	function setMaskMode(event: Event) {
		const mode = (event.currentTarget as HTMLSelectElement).value as 'alpha' | 'luminance';
		executeEditorStateCommand(store, 'Set mask mode', (state) =>
			setSelectedMaskMode(state, mode)
		);
	}

	function setFilter(event: Event) {
		const preset = (event.currentTarget as HTMLSelectElement).value;
		executeEditorStateCommand(store, 'Set filter', (state) =>
			setSelectedFilterPreset(state, preset)
		);
	}
</script>

{#if selection.effectTarget}
	<section class="selection-controls__section" aria-labelledby="selection-effects-label">
		<h2 id="selection-effects-label">Effects</h2>
		<div class="selection-controls__fields">
			{#if selection.effectTarget.props.maskEffect}
				<label class="selection-controls__field"
					><span>Mask mode</span><select
						value={selection.effectTarget.props.maskEffect.mode}
						onchange={setMaskMode}
						aria-label="Mask mode"
						><option value="alpha">Alpha</option><option value="luminance"
							>Luminance</option
						></select
					></label>
			{/if}
			<label class="selection-controls__field"
				><span>Filter</span><select
					value={filterPresetForShape(selection.effectTarget)}
					onchange={setFilter}
					aria-label="Filter"
					><option value="none">None</option><option value="blur">Blur</option><option
						value="grayscale">Grayscale</option
					><option value="drop_shadow">Drop shadow</option></select
				></label>
		</div>
	</section>
{/if}
