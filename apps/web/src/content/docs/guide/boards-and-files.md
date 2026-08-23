---
title: Boards and files
description: Manage browser boards, desktop drafts, native files, workspaces, and recovery.
section: Guide
group: Guide
order: 8
---

A board is the document you open in the editor. Its storage depends on whether you use the web or
desktop app.

## Board browser

Press **Cmd/Ctrl+B** to open the board browser. You can create, search, sort, inspect, duplicate,
rename, and delete boards. The browser identifies the active board, storage location, save state,
and last update.

Inkfinite flushes pending changes before switching boards. If a save or board action fails, the
browser keeps the current board open and reports the error. The list supports keyboard navigation
and narrow touch screens.

## Browser storage

The web app stores boards in IndexedDB for the current origin and browser profile. Another browser,
profile, or deployment origin has a separate database. Clearing site data or using private browsing
can remove access to those boards.

Export important browser work. Use the desktop app when you need a native file that you can copy,
version, or inspect with the CLI.

## Desktop files and drafts

A new desktop board is a draft in the app's local data directory. Choose **Save As** to create a
named `.inkfinite` file. **Save** writes later changes to that file. Import and export paths remain
separate from the native document path.

The desktop board browser also lists recent files and can work with a selected workspace directory.
Open documents through the desktop app so it can manage file locks, recovery data, and live CLI
sessions.

## Recovery

Canonical writes use a temporary file and atomic replacement. If recovery data is available after
an interrupted write, validate it and save it as a new native file rather than overwriting the last
known file blindly. Do not remove a sidecar lock while the desktop app or CLI owns it.
