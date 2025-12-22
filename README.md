# INKFINITE

An infinite canvas whiteboard application for creative visual thinking and collaboration.

## Overview

Inkfinite is a web-based infinite canvas application.

## Architecture

Inkfinite is built with a reactive architecture and optimized canvas rendering.
There are pan, zoom, and shape manipulation tools.

The project is organized as a pnpm monorepo with the following structure:

```sh
.
├── packages/
│   ├── core/          # Core logic and state management
│   └── renderer/      # Canvas rendering engine
└── apps/
    └── web/           # SvelteKit web application
```

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

SvelteKit-based web application providing the user interface.

### Tech Stack

- **Testing:** Vitest with Playwright (browser tests) and Node (unit tests)

### Development

```bash
pnpm dev      # Start development server
pnpm build    # Build for production
pnpm test     # Run tests
```

</details>

## Development

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build all packages
pnpm build

# Start web app in development
cd apps/web
pnpm dev
```

<details>
<summary>
Project Structure
</summary>

```sh
.
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── math.ts        # Vector and matrix math
│   │   │   ├── camera.ts      # Camera transforms
│   │   │   ├── geom.ts        # Geometry utilities
│   │   │   ├── model.ts       # Data structures
│   │   │   ├── reactivity.ts  # State management
│   │   │   └── actions.ts     # Input system
│   │   └── package.json
│   └── renderer/
│       ├── src/
│       │   └── index.ts       # Canvas renderer
│       └── package.json
└── apps/
    └── web/
        ├── src/
        │   ├── routes/        # SvelteKit routes
        │   └── lib/           # Svelte components
        └── package.json
```

</details>

<details>
<summary>
Design Principles
</summary>

### Code Organization

- **Namespace pattern** - Types and operations co-located (e.g., `Vec2` type + `Vec2.add()` function)
- **Pure functions** - Immutable operations, no side effects
- **Type safety** - Full TypeScript coverage with strict mode

### Coordinate Systems

- **World space** - Infinite 2D plane for shape coordinates
- **Screen space** - Viewport pixels, origin at top-left
- **Camera** - Mediates between world and screen coordinates

</details>

<details>
<summary>
Theme
</summary>

- **Light:** Nord color palette
- **Dark:** Iceberg.vim color palette
- **Font:** Open Sans

</details>
