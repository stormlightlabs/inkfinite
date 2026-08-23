---
title: Web
description: Use the browser editor and understand where it stores boards.
section: Platforms
group: Platforms
order: 9
---

The web editor provides the full canvas interface without access to native `.inkfinite` files.
See the [Editor guide](/docs/guide/editor/) for tools, gestures, selection, and styling.

## Open the editor

The hosted editor lives at [`/app`](/app). It loads the Rust document engine through WebAssembly
and stores boards for the current site in the browser. To run your own build, follow
[Building from source](/docs/development/building-from-source/).

## Storage and backups

The web editor stores boards in IndexedDB for the current origin and browser profile. It does not
write canonical files to your filesystem, and another browser or deployment origin has a separate
database.

Export work that you cannot afford to lose. Browser storage may disappear when you clear site data,
remove a profile, or use private browsing. Use the desktop app when you want a canonical
`.inkfinite` file that can be copied, versioned, or changed by the CLI.

Excalidraw and Obsidian Canvas exports preserve supported editable content but may omit features
that the target format cannot represent. PNG and SVG exports are presentation copies. See
[File format](/docs/reference/file-format/) before relying on an export as a backup.
