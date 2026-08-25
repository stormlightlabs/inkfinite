<script lang="ts">
	import type { PaintValue, Store } from '@inkfinite/core';
	import { PaintPicker } from '../../index';
	import { DEFAULT_FILL_COLOR, DEFAULT_STROKE_COLOR } from '../constants';
	import { executeEditorStateCommand } from '../commands';
	import {
		setSelectedFillPaint,
		setSelectedOpacity,
		setSelectedStrokePaint
	} from '@inkfinite/core';
	import type { SelectionInspectorState } from '../selection-inspector';

	let { store, selection }: { store: Store; selection: SelectionInspectorState } = $props();

	function applyFillPaint(paint: PaintValue) {
		executeEditorStateCommand(store, 'Set fill paint', (state) =>
			setSelectedFillPaint(state, paint)
		);
	}

	function applyStrokePaint(paint: PaintValue) {
		executeEditorStateCommand(store, 'Set stroke paint', (state) =>
			setSelectedStrokePaint(state, paint)
		);
	}

	function handleOpacityChange(
		event: Event,
		field: 'opacity' | 'fillOpacity' | 'strokeOpacity'
	) {
		const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
		if (Number.isFinite(value)) {
			executeEditorStateCommand(
				store,
				field === 'opacity' ? 'Set opacity' : `Set ${field}`,
				(state) => setSelectedOpacity(state, field, value)
			);
		}
	}
</script>

{#if selection.fillTargets.length > 0 || selection.strokeTargets.length > 0 || selection.fillOpacityTargets.length > 0 || selection.strokeOpacityTargets.length > 0}
	<section class="selection-controls__section" aria-labelledby="selection-appearance-label">
		<h2 id="selection-appearance-label">Appearance</h2>
		<div class="selection-controls__controls">
			{#if selection.fillTargets.length > 0}
				<div class="selection-controls__color-control">
					<span>Fill</span>
					<PaintPicker
						label="Fill color"
						value={selection.fillColorState.value || DEFAULT_FILL_COLOR}
						mixed={selection.fillColorState.mixed}
						onchange={applyFillPaint} />
				</div>
			{/if}
			{#if selection.strokeTargets.length > 0}
				<div class="selection-controls__color-control">
					<span>Stroke</span>
					<PaintPicker
						label="Stroke color"
						value={selection.strokeColorState.value || DEFAULT_STROKE_COLOR}
						mixed={selection.strokeColorState.mixed}
						onchange={applyStrokePaint} />
				</div>
			{/if}
			{#if selection.fillOpacityTargets.length > 0}
				{@render OpacityControl('Fill opacity', selection.fillOpacityState, (event) =>
					handleOpacityChange(event, 'fillOpacity')
				)}
			{/if}
			{#if selection.strokeOpacityTargets.length > 0}
				{@render OpacityControl('Stroke opacity', selection.strokeOpacityState, (event) =>
					handleOpacityChange(event, 'strokeOpacity')
				)}
			{/if}
			{#if selection.selectionCount > 0}
				{@render OpacityControl('Opacity', selection.opacityState, (event) =>
					handleOpacityChange(event, 'opacity')
				)}
			{/if}
		</div>
	</section>
{/if}

{#snippet OpacityControl(
	label: string,
	state: { value: number; mixed: boolean },
	onChange: (event: Event) => void
)}
	<label class="selection-controls__range-control">
		<span>{label}</span>
		<input
			type="range"
			min="0"
			max="1"
			step="0.05"
			value={state.value}
			onchange={onChange}
			aria-label={label}
			aria-valuetext={state.mixed ? 'Mixed values' : `${Math.round(state.value * 100)}%`} />
		<output>{state.mixed ? 'Mixed' : `${Math.round(state.value * 100)}%`}</output>
	</label>
{/snippet}
