import { isWritableLayer, type EditorLayerRecord } from '@inkfinite/core';

/** Chooses the nearest writable layer that can receive deleted layer contents. */
export function nearestWritableDestination(
	layers: EditorLayerRecord[],
	sourceId: string
): EditorLayerRecord | null {
	const sourceIndex = layers.findIndex((layer) => layer.id === sourceId);
	return (
		[...layers]
			.filter((layer) => layer.id !== sourceId && isWritableLayer(layer))
			.sort(
				(a, b) =>
					Math.abs(layers.findIndex((layer) => layer.id === a.id) - sourceIndex) -
					Math.abs(layers.findIndex((layer) => layer.id === b.id) - sourceIndex)
			)[0] ?? null
	);
}

/** Returns writable rehome destinations for the delete confirmation. */
export function deleteLayerDestinations(
	layers: EditorLayerRecord[],
	sourceId: string
): EditorLayerRecord[] {
	return layers.filter((layer) => layer.id !== sourceId && isWritableLayer(layer));
}
