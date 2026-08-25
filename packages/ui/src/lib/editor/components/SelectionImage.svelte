<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import { executeEditorStateCommand } from '../commands';
	import { setSelectedImageFields } from '@inkfinite/core';
	import { sampleImageColors, type SampledImageColor } from '../image-sampling';
	import type { SelectionInspectorState } from '../selection-inspector';

	let { store, selection }: { store: Store; selection: SelectionInspectorState } = $props();
	let sampledColors = $state<SampledImageColor[]>([]);
	let samplingColors = $state(false);
	let sampledColorMessage = $state<string | null>(null);

	$effect(() => {
		selection.imageTarget?.id;
		sampledColors = [];
		sampledColorMessage = null;
	});

	function updateImageFields(
		label: string,
		fields: Parameters<typeof setSelectedImageFields>[1]
	) {
		executeEditorStateCommand(store, label, (state) => setSelectedImageFields(state, fields));
	}

	async function sampleSelectedImage() {
		const asset = selection.imageAsset;
		if (!asset || samplingColors) return;
		samplingColors = true;
		sampledColorMessage = null;
		try {
			sampledColors = await sampleImageColors(asset.mediaType, asset.bytes);
			if (sampledColors.length === 0) sampledColorMessage = 'No colors were found.';
		} catch (error) {
			sampledColorMessage =
				error instanceof Error ? error.message : 'The image could not be sampled.';
		} finally {
			samplingColors = false;
		}
	}

	async function copySampledColor(color: string) {
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			await navigator.clipboard.writeText(color);
			sampledColorMessage = `${color} copied`;
		}
	}
</script>

{#if selection.imageTarget}
	<section
		class="selection-controls__section selection-controls__section--image"
		aria-labelledby="selection-image-label">
		<h2 id="selection-image-label">Image</h2>
		<div class="selection-controls__image-fields">
			<label class="selection-controls__field selection-controls__field--wide"
				><span>Asset</span><select
					value={selection.imageTarget.props.assetId}
					onchange={(event) =>
						updateImageFields('Reuse image asset', {
							assetId: (event.currentTarget as HTMLSelectElement).value
						})}
					aria-label="Image asset">
					{#each Object.values(selection.imageTarget ? (store.getState().doc.assets ?? {}) : {}).filter( (asset) => asset.mediaType.startsWith('image/') ) as asset}<option
							value={asset.id}>{asset.name}</option
						>{/each}
				</select></label>
			<label class="selection-controls__field selection-controls__field--wide"
				><span>Caption</span><input
					type="text"
					value={selection.imageTarget.props.caption ?? ''}
					onchange={(event) =>
						updateImageFields('Set image caption', {
							caption: (event.currentTarget as HTMLInputElement).value || undefined
						})}
					aria-label="Image caption" /></label>
			<label class="selection-controls__field"
				><span>Mask</span><select
					value={selection.imageTarget.props.mask?.kind ?? 'rectangle'}
					onchange={(event) => {
						const kind = (event.currentTarget as HTMLSelectElement).value as
							| 'rectangle'
							| 'ellipse'
							| 'rounded';
						updateImageFields('Set image mask', {
							mask: kind === 'rectangle' ? undefined : { kind }
						});
					}}
					aria-label="Image mask"
					><option value="rectangle">Rectangle</option><option value="ellipse"
						>Ellipse</option
					><option value="rounded">Rounded</option></select
				></label>
			{#if selection.imageTarget.props.mask?.kind === 'rounded'}
				<label class="selection-controls__field selection-controls__field--small"
					><span>Radius</span><input
						type="number"
						min="0"
						max={Math.min(
							selection.imageTarget.props.w,
							selection.imageTarget.props.h
						) / 2}
						value={selection.imageTarget.props.mask.radius ?? 16}
						onchange={(event) =>
							updateImageFields('Set image mask radius', {
								mask: {
									kind: 'rounded',
									radius: Math.max(
										0,
										(event.currentTarget as HTMLInputElement).valueAsNumber ||
											0
									)
								}
							})}
						aria-label="Image mask radius" /></label>
			{/if}
		</div>
		<div class="selection-controls__image-sampling">
			<button
				class="selection-controls__action"
				type="button"
				disabled={samplingColors || !selection.imageAsset}
				onclick={() => void sampleSelectedImage()}
				><span>{samplingColors ? 'Sampling…' : 'Sample colors'}</span></button>
			{#each sampledColors as sampled}<button
					class="selection-controls__sample"
					type="button"
					style={`--sample-color: ${sampled.color}`}
					title={`Copy ${sampled.color}`}
					aria-label={`Copy sampled color ${sampled.color}`}
					onclick={() => void copySampledColor(sampled.color)}></button
				>{/each}
			{#if sampledColorMessage}<small>{sampledColorMessage}</small>{/if}
		</div>
	</section>
{/if}
