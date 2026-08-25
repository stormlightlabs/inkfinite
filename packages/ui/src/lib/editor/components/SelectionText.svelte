<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import { EDITOR_FONT_GROUPS } from '../fonts';
	import { executeEditorStateCommand } from '../commands';
	import { setSelectedTypography } from '@inkfinite/core';
	import type { SelectionInspectorState } from '../selection-inspector';

	let { store, selection }: { store: Store; selection: SelectionInspectorState } = $props();

	function setFontSize(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
		if (Number.isFinite(value) && value > 0) {
			executeEditorStateCommand(store, 'Set font size', (state) =>
				setSelectedTypography(state, 'fontSize', value)
			);
		}
	}

	function setFontFamily(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value.trim();
		if (value) {
			executeEditorStateCommand(store, 'Set font family', (state) =>
				setSelectedTypography(state, 'fontFamily', value)
			);
		}
	}
</script>

{#if selection.typographyTargets.length > 0}
	<section class="selection-controls__section" aria-labelledby="selection-type-label">
		<h2 id="selection-type-label">Typography</h2>
		<div class="selection-controls__controls selection-controls__typography">
			<label class="selection-controls__field">
				<span>Font</span>
				<select
					value={selection.fontFamilyState.mixed ? '' : selection.fontFamilyState.value}
					onchange={setFontFamily}
					aria-label="Font family">
					{#if selection.fontFamilyState.mixed}
						<option value="" disabled>Mixed</option>
					{:else if !EDITOR_FONT_GROUPS.some( (group) => group.fonts.some((font) => font.family === selection.fontFamilyState.value) )}
						<option value={selection.fontFamilyState.value}
							>{selection.fontFamilyState.value}</option>
					{/if}
					{#each EDITOR_FONT_GROUPS as group}
						<optgroup label={group.label}>
							{#each group.fonts as font}
								<option value={font.family} style:font-family={font.family}
									>{font.label}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>
			<label class="selection-controls__field selection-controls__field--small">
				<span>Size</span>
				<input
					type="number"
					min="1"
					step="1"
					value={selection.fontSizeState.mixed ? '' : selection.fontSizeState.value}
					placeholder={selection.fontSizeState.mixed ? 'Mixed' : undefined}
					onchange={setFontSize}
					aria-label="Font size" />
			</label>
		</div>
	</section>
{/if}
