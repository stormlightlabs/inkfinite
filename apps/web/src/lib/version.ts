import { version as VERSION } from '$app/environment';

const REPOSITORY_URL = 'https://github.com/stormlightlabs/inkfinite';

/** Git-derived version details embedded in each web build. */
export type BuildVersion = { display: string; commit: string; version: string };

const fallbackVersion: BuildVersion = { display: 'v0.0.0', commit: 'unknown', version: 'v0.0.0' };

function isBuildVersion(value: unknown): value is BuildVersion {
	if (!value || typeof value !== 'object') return false;

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.display === 'string' &&
		typeof candidate.commit === 'string' &&
		typeof candidate.version === 'string'
	);
}

function parseBuildVersion(value: string): BuildVersion {
	try {
		const parsed: unknown = JSON.parse(value);
		if (isBuildVersion(parsed)) return parsed;
	} catch {
		// Development and fallback builds can expose an ordinary SvelteKit version string.
	}

	return fallbackVersion;
}

/** Version details for the current web build. */
export const buildVersion = parseBuildVersion(VERSION);

/** Source page for the commit used by the current web build. */
export const buildCommitUrl =
	buildVersion.commit === 'unknown'
		? REPOSITORY_URL
		: `${REPOSITORY_URL}/commit/${buildVersion.commit}`;
