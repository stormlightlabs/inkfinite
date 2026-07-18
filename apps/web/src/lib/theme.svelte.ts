import { browser } from '$app/environment';

/** Explicit color themes supported by the web editor. */
export type Theme = 'light' | 'dark';

/** Reactive light and dark theme state shared by the web editor. */
export class ThemeStore {
	#theme = $state<Theme>('dark');
	/** Currently active theme, derived from the store's private mutable state. */
	readonly current = $derived(this.#theme);

	constructor() {
		const stored = browser ? localStorage.getItem('theme') : null;
		this.#theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
		this.#syncTheme();
	}

	/** Switches between the light and dark themes. */
	toggle() {
		this.set(this.#theme === 'dark' ? 'light' : 'dark');
	}

	/** Applies and persists an explicit theme. */
	set(theme: Theme) {
		this.#theme = theme;
		this.#syncTheme();
	}

	#syncTheme() {
		if (!browser) return;

		localStorage.setItem('theme', this.#theme);
		document.documentElement.setAttribute('data-theme', this.#theme);
		document.documentElement.setAttribute('data-ink-theme', this.#theme);
	}
}

export const themeStore = new ThemeStore();
