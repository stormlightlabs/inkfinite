# Inkfinite desktop

The desktop application is a Tauri 2 app with its own static SvelteKit
composition root. It renders `@inkfinite/ui/editor` and supplies the Tauri
platform adapter from `src/lib/platform.ts`.

Rust owns desktop document sessions, file access, validation, recovery, and
transaction application. The frontend keeps a materialized editing mirror and
communicates through typed Tauri commands.

## Development

From the repository root:

```sh
pnpm --filter @inkfinite/desktop check
pnpm --filter @inkfinite/desktop test
pnpm --filter @inkfinite/desktop build
pnpm --filter @inkfinite/desktop tauri dev
pnpm --filter @inkfinite/desktop tauri build
```

The desktop build does not build or package `apps/web`. Both applications
compile the shared editor from `packages/ui` independently.
