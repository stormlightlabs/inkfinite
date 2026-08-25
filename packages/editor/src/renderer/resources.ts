type RendererAsset = { digest: string; mediaType: string; bytes: number[] };

/** Small least-recently-used cache used by a renderer instance. */
export class LruCache<Key, Value> {
	readonly #entries = new Map<Key, Value>();

	constructor(private readonly capacity: number) {}

	get(key: Key): Value | undefined {
		const value = this.#entries.get(key);
		if (value === undefined) return undefined;
		this.#entries.delete(key);
		this.#entries.set(key, value);
		return value;
	}

	set(key: Key, value: Value): void {
		this.#entries.delete(key);
		this.#entries.set(key, value);
		if (this.#entries.size <= this.capacity) return;
		const oldestKey = this.#entries.keys().next().value;
		if (oldestKey !== undefined) this.#entries.delete(oldestKey);
	}

	clear(): void {
		this.#entries.clear();
	}
}

/** Text and image resources owned by one renderer lifecycle. */
export class RendererResources {
	readonly textLayoutCache = new LruCache<string, string[]>(512);
	readonly textMetricCache = new LruCache<string, number>(2_048);
	readonly markdownLayoutCache = new LruCache<string, import('./text.js').MarkdownLine[]>(256);
	readonly images = new RendererImageCache();

	/** Release cached values when the renderer is disposed. */
	dispose(): void {
		this.textLayoutCache.clear();
		this.textMetricCache.clear();
		this.markdownLayoutCache.clear();
		this.images.clear();
	}
}

/** Image cache with an explicit renderer lifetime and async redraw callback. */
export class RendererImageCache {
	readonly #images = new Map<string, HTMLImageElement>();

	get(asset: RendererAsset, onLoaded: () => void): HTMLImageElement | undefined {
		let image = this.#images.get(asset.digest);
		if (!image && typeof Image !== 'undefined') {
			image = new Image();
			image.onload = onLoaded;
			image.src = `data:${asset.mediaType};base64,${bytesToBase64(asset.bytes)}`;
			this.#images.set(asset.digest, image);
		}
		return image;
	}

	clear(): void {
		for (const image of this.#images.values()) image.onload = null;
		this.#images.clear();
	}
}

function bytesToBase64(bytes: number[]): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return typeof btoa === 'function' ? btoa(binary) : '';
}
