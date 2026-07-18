# Inkfinite UI

Shared Svelte 5 components and design tokens for Inkfinite's web app and Tauri desktop shell.

The package exports buttons, icon buttons, semantic icons, panels, toolbars,
dialogs, sheets, and brush settings. Application components should compose these
controls while keeping document, runtime, persistence, and Tauri dependencies in
the consuming app.

The light theme uses Eldritch Dusk. The dark theme uses the restrained Eldritch Abyss palette. IBM Plex Sans Variable is the body face; Playpen Sans Variable is reserved for display text and handwritten accents. UnoCSS generates a small, fixed Iconify bundle from Phosphor, Tabler, and Bootstrap Icons.

## Use the library

Add `@inkfinite/ui` as a workspace dependency, then import the global theme once near the application root:

```svelte
<script lang="ts">
  import "@inkfinite/ui/styles.css";
  import { Button } from "@inkfinite/ui";
</script>

<Button icon="save" label="Save drawing" variant="primary" />
```

Set `data-ink-theme="light"` or `data-ink-theme="dark"` on the document root or any themed subtree. Leave the attribute unset to follow `prefers-color-scheme`.

## Develop and verify

From the repository root:

```sh
pnpm --filter @inkfinite/ui dev
pnpm --filter @inkfinite/ui storybook
pnpm --filter @inkfinite/ui check
pnpm --filter @inkfinite/ui test
pnpm --filter @inkfinite/ui playwright
pnpm --filter @inkfinite/ui storybook:build
pnpm --filter @inkfinite/ui build
pnpm --filter @inkfinite/ui build:workshop
```

Run `pnpm --filter @inkfinite/ui icons:generate` after changing the semantic icon map in `src/lib/icons.ts`. Commit the generated `src/lib/styles/icons.css` so consumers do not need UnoCSS in their applications.
