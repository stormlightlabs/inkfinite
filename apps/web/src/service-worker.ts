/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { build, files, prerendered, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const cacheName = `inkfinite-${version}`;
const precache = [...new Set([...build, ...files, ...prerendered])];

worker.addEventListener('install', (event) => {
	event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(precache)));
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const oldCaches = (await caches.keys()).filter(
				(name) => name.startsWith('inkfinite-') && name !== cacheName
			);
			await Promise.all(oldCaches.map((name) => caches.delete(name)));
			await worker.clients.claim();
		})()
	);
});

worker.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') void worker.skipWaiting();
});

worker.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	if (url.origin !== worker.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(cacheName);
			if (precache.includes(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}

			try {
				const response = await fetch(event.request);
				if (response.ok) await cache.put(event.request, response.clone());
				return response;
			} catch (error) {
				const cached = await cache.match(event.request);
				if (cached) return cached;

				if (event.request.mode === 'navigate') {
					const appShell = await cache.match('/app');
					if (appShell) return appShell;
				}

				throw error;
			}
		})()
	);
});
