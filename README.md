# Inkfinite

A web-based infinite canvas application for creative visual thinking.

## Architecture

Inkfinite is built with reactivity, vector math, and optimized canvas rendering.

The project is organized as a pnpm and Cargo monorepo:

```sh
.
├── packages/
│   ├── core/          # Core logic and state management
│   ├── renderer/      # Canvas rendering engine
│   ├── runtime/       # Framework-neutral editor interaction
│   └── ui/            # UI primitives and shared editor module
├── crates/
│   ├── inkfinite-core/ # Rust document engine and file format
│   └── inkfinite-cli/  # File-mode and live desktop CLI
└── apps/
    ├── web/           # Static SvelteKit app with a Dexie adapter
    └── desktop/       # Tauri app with its own SvelteKit root
```

The web and desktop apps build independently. Both render the editor exported by
`@inkfinite/ui/editor`. The web composition root supplies Dexie persistence; the
desktop composition root supplies typed Tauri commands backed by Rust-owned
document sessions.

## Packages

<details>
<summary><code>packages/core</code></summary>

### Modules

- **Math** (`math.ts`) - Vector mathematics and geometric operations
  - `Vec2`: 2D vector operations (add, subtract, scale, normalize, distance, etc.)
  - `Mat3`: 3x3 transformation matrices for 2D transforms
  - `Box2`: Axis-aligned bounding boxes

- **Camera** (`camera.ts`) - Viewport and coordinate system transforms
  - World ↔ screen coordinate conversions
  - Pan and zoom operations
  - Camera state management

- **Geometry** (`geom.ts`) - Shape hit testing and spatial queries
  - Point-in-shape testing
  - Bounding box calculations
  - Shape picking/selection

- **Reactivity** (`reactivity.ts`) - Observable state management
  - RxJS-based reactive store
  - State subscription and updates
  - Computed values and derived state

- **Model** (`model.ts`) - Data structures and types
  - Shape definitions (rect, ellipse, line, arrow, text)
  - Editor state
  - Page management

- **Actions** (`actions.ts`) - User input event system
  - Input event normalization
  - Pointer, keyboard, and wheel events
  - Coordinate space conversions

</details>

<details>
<summary><code>packages/renderer</code></summary>

High-performance canvas renderer with:

- Reactive Rendering: Subscribes to state changes and efficiently redraws
- Optimized Drawing: Uses requestAnimationFrame with dirty flag pattern
- HiDPI Support: Automatic pixel ratio scaling for crisp rendering
- Camera Transforms: Applies world-to-screen transformations
- Shape Rendering: Draws all shape types (rect, ellipse, line, arrow, text)
- Selection Visualization: Highlights selected shapes with dashed outlines
- Text Wrapping: Automatic text layout within bounded areas

</details>

<details>
<summary><code>apps/web</code></summary>

Static SvelteKit application for browser use. It stores local boards in
IndexedDB through its Dexie adapter and contains no Tauri dependencies.

### Tech Stack

- **Testing:** Vitest with Playwright (browser tests) and Node (unit tests)
- **Persistence:** IndexedDB through the app-owned Dexie adapter

### Development

```bash
pnpm dev      # Start development server
pnpm build    # Build for production
pnpm test     # Run tests
```

</details>

<details>
<summary><code>apps/desktop</code></summary>

Tauri desktop application with its own thin SvelteKit composition root. It uses
the same editor module as the web app while keeping native persistence in Rust.

### Features

- Native file dialogs (Open/Save)
- Rust-owned `.inkfinite` document sessions
- Recent files tracking
- Shared editor UI with a desktop-owned adapter

### Tech Stack

- **Framework:** Tauri v2
- **Frontend:** SvelteKit composition root using `@inkfinite/ui/editor`
- **Backend:** Rust with Tauri plugins (dialog, fs, store)

### Development

#### Prerequisites

**Standard Setup:**

- Node.js 18+
- pnpm 8+

**Nix/NixOS Setup:**

- Nix with flakes enabled
- For desktop app: Rust via [rustup](https://rustup.rs) (not Nix)

```bash
cd apps/desktop

# Development mode (with hot reload)
pnpm tauri dev

# Build production app
pnpm tauri build
```

The Rust CLI will use `inkfinite-core` directly for closed files and connect to
the running desktop app through authenticated local IPC for live control.

</details>
