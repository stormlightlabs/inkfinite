<script lang="ts">
	import { onMount } from 'svelte';

	let updateAvailable = $state(false);
	let updating = $state(false);
	let registration: ServiceWorkerRegistration | undefined;

	onMount(() => {
		if ('storage' in navigator && 'persist' in navigator.storage) {
			void navigator.storage.persist().catch(() => false);
		}

		if (!('serviceWorker' in navigator)) return;

		let disposed = false;
		let installing: ServiceWorker | null | undefined;

		const inspectInstallingWorker = () => {
			installing = registration?.installing;
			installing?.addEventListener('statechange', () => {
				if (
					!disposed &&
					installing?.state === 'installed' &&
					navigator.serviceWorker.controller
				) {
					updateAvailable = true;
				}
			});
		};

		void navigator.serviceWorker.ready.then((readyRegistration) => {
			if (disposed) return;
			registration = readyRegistration;
			updateAvailable = Boolean(registration.waiting);
			registration.addEventListener('updatefound', inspectInstallingWorker);
			void registration.update();
		});

		const checkForUpdate = () => {
			if (document.visibilityState === 'visible') void registration?.update();
		};
		document.addEventListener('visibilitychange', checkForUpdate);

		return () => {
			disposed = true;
			document.removeEventListener('visibilitychange', checkForUpdate);
			registration?.removeEventListener('updatefound', inspectInstallingWorker);
		};
	});

	function applyUpdate() {
		const waiting = registration?.waiting;
		if (!waiting) return;

		updating = true;
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
			once: true
		});
		waiting.postMessage({ type: 'SKIP_WAITING' });
	}
</script>

{#if updateAvailable}
	<div class="update-notice" role="status" aria-live="polite">
		<span>A new version of Inkfinite is ready.</span>
		<button type="button" onclick={applyUpdate} disabled={updating}>
			{updating ? 'Updating…' : 'Update and reload'}
		</button>
	</div>
{/if}

<style>
	.update-notice {
		position: fixed;
		right: max(1rem, env(safe-area-inset-right));
		bottom: max(1rem, env(safe-area-inset-bottom));
		z-index: 1000;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		max-width: min(30rem, calc(100vw - 2rem));
		padding: 0.7rem 0.75rem 0.7rem 1rem;
		border: 1px solid var(--color-border, #ccd3de);
		border-radius: 0.65rem;
		background: var(--color-surface, #f7f8fb);
		box-shadow: 0 0.5rem 1.5rem rgb(20 30 45 / 18%);
		color: var(--color-text, #202734);
		font:
			500 0.875rem/1.35 system-ui,
			sans-serif;
	}

	button {
		min-height: 2.75rem;
		padding: 0.55rem 0.8rem;
		border: 0;
		border-radius: 0.45rem;
		background: #8a69f7;
		color: white;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: #7656db;
	}

	button:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.72;
	}

	@media (max-width: 32rem) {
		.update-notice {
			left: 1rem;
			right: 1rem;
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
