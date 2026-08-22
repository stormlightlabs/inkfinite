/** A color sampled from an embedded raster image. */
export type SampledImageColor = { color: string; count: number };

/**
 * Extracts the most frequent opaque colors from an embedded raster asset.
 *
 * Sampling happens in a small off-screen canvas so large images do not block the
 * editor while a palette is being prepared. Browsers without canvas support
 * return an empty palette instead of preventing image editing.
 */
export async function sampleImageColors(
	mediaType: string,
	bytes: readonly number[],
	maximum = 6
): Promise<SampledImageColor[]> {
	if (
		typeof Image === 'undefined' ||
		typeof document === 'undefined' ||
		typeof Blob === 'undefined' ||
		typeof URL === 'undefined'
	) {
		return [];
	}
	const image = new Image();
	const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaType }));
	try {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('The image could not be sampled.'));
			image.src = url;
		});
		const canvas = document.createElement('canvas');
		const size = 32;
		canvas.width = size;
		canvas.height = size;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) return [];
		context.drawImage(image, 0, 0, size, size);
		const pixels = context.getImageData(0, 0, size, size).data;
		const buckets = new Map<string, number>();
		for (let index = 0; index < pixels.length; index += 4) {
			const alpha = pixels[index + 3] ?? 0;
			if (alpha < 32) continue;
			const red = Math.round((pixels[index] ?? 0) / 16) * 16;
			const green = Math.round((pixels[index + 1] ?? 0) / 16) * 16;
			const blue = Math.round((pixels[index + 2] ?? 0) / 16) * 16;
			const color = `#${[red, green, blue]
				.map((channel) => Math.min(255, channel).toString(16).padStart(2, '0'))
				.join('')}`;
			buckets.set(color, (buckets.get(color) ?? 0) + 1);
		}
		return [...buckets.entries()]
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
			.slice(0, Math.max(1, maximum))
			.map(([color, count]) => ({ color, count }));
	} finally {
		URL.revokeObjectURL(url);
	}
}
