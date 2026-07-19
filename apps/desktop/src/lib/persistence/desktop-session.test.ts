import type { DesktopFileOps, FileHandle } from "@inkfinite/core";
import type {
	ApplyAuthorization,
	ChangeHash,
	DocumentSnapshot,
	Proposal,
	TransactionDraft,
} from "@inkfinite/bindings";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDesktopSessionRepo,
  type SessionApi,
  type SessionCommit,
  type SessionOpened,
  type SessionSaved,
  type SessionStatus,
} from "$lib/persistence/desktop-session";

type FakeSession = {
  status: SessionStatus;
  undo: DocumentSnapshot[];
  redo: DocumentSnapshot[];
};

function createSnapshot(documentId: string, pageName = "Page 1", heads: ChangeHash[] = ["head:0"]): DocumentSnapshot {
  const pageId = `page:${documentId}:1`;
  const layerId = `layer:${documentId}:1`;
  return {
    format: "inkfinite",
    format_version: 2,
    document_id: documentId,
    heads,
    document: {
      pages: {
        [pageId]: { id: pageId, name: pageName, layer_ids: [layerId], version: 1 },
      },
      page_ids: [pageId],
      layers: {
        [layerId]: {
          id: layerId,
          page_id: pageId,
          name: "Default",
          shape_ids: [],
          visible: true,
          locked: false,
          opacity: 1,
          version: 1,
        },
      },
      shapes: {},
      bindings: {},
      assets: {},
    },
  };
}

function createFakeSessionApi() {
  const files = new Map<string, DocumentSnapshot>();
  const sessions = new Map<string, FakeSession>();
  let sessionNumber = 0;
  let headNumber = 0;

  function statusFor(sessionId: string, session: FakeSession): SessionStatus {
    return {
      ...session.status,
      snapshot: structuredClone(session.status.snapshot),
    };
  }

  function commitResult(transaction: TransactionDraft, snapshot: DocumentSnapshot): SessionCommit["commit"] {
    return {
      transaction_id: transaction.id,
      heads: snapshot.heads,
      patch: { created: [], changed: [], deleted: [] },
      affected_ids: [],
      affected_regions: [],
      inverse: { actor_id: transaction.actor_id, operations: [] },
      warnings: [],
    };
  }

  const api = {
    async createDocument(args: Parameters<SessionApi["createDocument"]>[0]): Promise<SessionOpened> {
      const sessionId = `session:${++sessionNumber}`;
      const snapshot = createSnapshot(args.document_id, args.page_name || "Page 1");
      const status: SessionStatus = {
        session_id: sessionId,
        path: args.path,
        actor_id: args.actor_id,
        snapshot,
        dirty: false,
        lock_held: true,
        recovery_available: false,
        can_undo: false,
        can_redo: false,
        sync: { status: "disabled" },
      };
      sessions.set(sessionId, { status, undo: [], redo: [] });
      files.set(args.path, structuredClone(snapshot));
      return { session_id: sessionId, status: statusFor(sessionId, sessions.get(sessionId)!) };
    },

    async openDocument(args: Parameters<SessionApi["openDocument"]>[0]): Promise<SessionOpened> {
      const stored = files.get(args.path);
      if (!stored) throw new Error(`Missing fake document: ${args.path}`);
      const sessionId = `session:${++sessionNumber}`;
      const status: SessionStatus = {
        session_id: sessionId,
        path: args.path,
        actor_id: args.actor_id,
        snapshot: structuredClone(stored),
        dirty: false,
        lock_held: true,
        recovery_available: false,
        can_undo: false,
        can_redo: false,
        sync: { status: "disabled" },
      };
      sessions.set(sessionId, { status, undo: [], redo: [] });
      return { session_id: sessionId, status: statusFor(sessionId, sessions.get(sessionId)!) };
    },

    async snapshot(args: Parameters<SessionApi["snapshot"]>[0]) {
      const session = sessions.get(args.session_id);
      if (!session) throw new Error("Missing fake session");
      return statusFor(args.session_id, session);
    },

    async commit(args: Parameters<SessionApi["commit"]>[0]): Promise<SessionCommit> {
      const session = sessions.get(args.session_id);
      if (!session) throw new Error("Missing fake session");
      const next = structuredClone(session.status.snapshot);
      for (const operation of args.transaction.operations) {
        if (operation.type === "rename_page") {
          const page = next.document.pages[operation.page_id];
          if (page) {
            page.name = operation.name;
            page.version += 1;
          }
        }
      }
      session.undo.push(structuredClone(session.status.snapshot));
      session.redo = [];
      next.heads = [`head:${++headNumber}`];
      session.status = {
        ...session.status,
        snapshot: next,
        dirty: true,
        can_undo: true,
        can_redo: false,
      };
      return {
        commit: commitResult(args.transaction, next),
        status: statusFor(args.session_id, session),
      };
    },

    async propose(_args: Parameters<SessionApi["propose"]>[0]): Promise<Proposal> {
      throw new Error("Proposals are not part of this fake session");
    },

    async acceptProposal(_args: Parameters<SessionApi["acceptProposal"]>[0]): Promise<SessionCommit> {
      throw new Error("Proposals are not part of this fake session");
    },

    async rejectProposal(_args: Parameters<SessionApi["rejectProposal"]>[0]): Promise<void> {
      throw new Error("Proposals are not part of this fake session");
    },

    async authorizeApply(_args: Parameters<SessionApi["authorizeApply"]>[0]): Promise<ApplyAuthorization> {
      throw new Error("Apply authorization is not part of this fake session");
    },

    async undo(args: Parameters<SessionApi["undo"]>[0]): Promise<SessionCommit> {
      const session = sessions.get(args.session_id);
      const previous = session?.undo.pop();
      if (!session || !previous) throw new Error("No fake undo history");
      session.redo.push(structuredClone(session.status.snapshot));
      previous.heads = [`head:${++headNumber}`];
      session.status = {
        ...session.status,
        snapshot: previous,
        dirty: true,
        can_undo: session.undo.length > 0,
        can_redo: true,
      };
      return {
        commit: commitResult(
          { id: "transaction:undo", actor_id: args.actor_id } as TransactionDraft,
          previous,
        ),
        status: statusFor(args.session_id, session),
      };
    },

    async redo(args: Parameters<SessionApi["redo"]>[0]): Promise<SessionCommit> {
      const session = sessions.get(args.session_id);
      const next = session?.redo.pop();
      if (!session || !next) throw new Error("No fake redo history");
      session.undo.push(structuredClone(session.status.snapshot));
      next.heads = [`head:${++headNumber}`];
      session.status = {
        ...session.status,
        snapshot: next,
        dirty: true,
        can_undo: true,
        can_redo: session.redo.length > 0,
      };
      return {
        commit: commitResult(
          { id: "transaction:redo", actor_id: args.actor_id } as TransactionDraft,
          next,
        ),
        status: statusFor(args.session_id, session),
      };
    },

    async save(args: Parameters<SessionApi["save"]>[0]): Promise<SessionSaved> {
      const session = sessions.get(args.session_id);
      if (!session) throw new Error("Missing fake session");
      files.set(session.status.path, structuredClone(session.status.snapshot));
      session.status = { ...session.status, dirty: false };
      return {
        save: { path: session.status.path, heads: session.status.snapshot.heads },
        status: statusFor(args.session_id, session),
      };
    },

    async saveAs(args: Parameters<SessionApi["saveAs"]>[0]): Promise<SessionSaved> {
      const session = sessions.get(args.session_id);
      if (!session) throw new Error("Missing fake session");
      files.set(args.path, structuredClone(session.status.snapshot));
      session.status = { ...session.status, path: args.path, dirty: false };
      return {
        save: { path: args.path, heads: session.status.snapshot.heads },
        status: statusFor(args.session_id, session),
      };
    },

    async query(args: Parameters<SessionApi["query"]>[0]) {
      const session = sessions.get(args.session_id);
      if (!session) throw new Error("Missing fake session");
      return { heads: session.status.snapshot.heads, records: [], bounds: {} };
    },

    async validate(args: Parameters<SessionApi["validate"]>[0]) {
      const session = sessions.get(args.session_id);
      if (!session) throw new Error("Missing fake session");
      return statusFor(args.session_id, session);
    },

    async syncConnect(args: Parameters<SessionApi["syncConnect"]>[0]) {
      const session = sessions.get(args.session_id);
      if (!session) throw new Error("Missing fake session");
      session.status = {
        ...session.status,
        sync: {
          status: "enabled",
          peers: [
            {
              peer_id: args.peer_id,
              pending_messages: 0,
              shared_heads: [],
              quarantine: null,
            },
          ],
          warning: null,
        },
      };
      return statusFor(args.session_id, session);
    },

    async syncDisconnect(args: Parameters<SessionApi["syncDisconnect"]>[0]) {
      const session = sessions.get(args.session_id);
      if (!session) throw new Error("Missing fake session");
      session.status = { ...session.status, sync: { status: "disabled" } };
      return statusFor(args.session_id, session);
    },

    async syncNext(_args: Parameters<SessionApi["syncNext"]>[0]) {
      return null;
    },

    async syncReceive(_args: Parameters<SessionApi["syncReceive"]>[0]): Promise<never> {
      throw new Error("Sync receive is not part of this fake session");
    },

    async close(args: Parameters<SessionApi["close"]>[0]) {
      sessions.delete(args.session_id);
    },
  } satisfies SessionApi;

  return { api, files };
}

function createFakeFileOps() {
  const recent: FileHandle[] = [];
  let workspace: string | null = null;
  let openPath: string | null = null;
  let savePath: string | null = null;
  let entries: Array<{ path: string; name: string; isDir: boolean }> = [];

  const ops: DesktopFileOps = {
    async showOpenDialog() {
      return openPath;
    },
    async showSaveDialog() {
      return savePath;
    },
    async getRecentFiles() {
      return [...recent];
    },
    async addRecentFile(handle) {
      recent.splice(0, recent.length, handle, ...recent.filter((item) => item.path !== handle.path));
    },
    async removeRecentFile(path) {
      const index = recent.findIndex((item) => item.path === path);
      if (index >= 0) recent.splice(index, 1);
    },
    async clearRecentFiles() {
      recent.splice(0, recent.length);
    },
    async getWorkspaceDir() {
      return workspace;
    },
    async setWorkspaceDir(path) {
      workspace = path;
    },
    async pickWorkspaceDir() {
      workspace = "/workspace";
      return workspace;
    },
    async readDirectory(directory, pattern) {
      const suffix = pattern?.replace("*", "") ?? "";
      return entries.filter((entry) => entry.path.startsWith(directory) && (!suffix || entry.name.includes(suffix)));
    },
    async renameFile() {},
    async deleteFile(path) {
      entries = entries.filter((entry) => entry.path !== path);
    },
  };

  return {
    ops,
    recent,
    setWorkspace(path: string | null) {
      workspace = path;
    },
    setOpenPath(path: string | null) {
      openPath = path;
    },
    setSavePath(path: string | null) {
      savePath = path;
    },
    setEntries(next: typeof entries) {
      entries = next;
    },
  };
}

describe("Rust-backed desktop session repository", () => {
  let fileOps: ReturnType<typeof createFakeFileOps>;
  let session: ReturnType<typeof createFakeSessionApi>;

  beforeEach(() => {
    fileOps = createFakeFileOps();
    session = createFakeSessionApi();
  });

  it("opens, edits, saves, reopens, undoes, and redoes through typed sessions", async () => {
    fileOps.setSavePath("/tmp/board.inkfinite");
    const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
    const boardId = await repo.createBoard("Board One");
    const pageId = Object.keys((await repo.loadDoc(boardId)).pages)[0];
    expect((await repo.validate()).snapshot.document_id).toBe(boardId);
    expect(
      (await repo.query({
        id: null,
        name: null,
        role: null,
        tag: null,
        shape_kind: null,
        page_id: null,
        layer_id: null,
        parent_id: null,
        bounds: null,
      })).records,
    ).toEqual([]);

    await repo.applyDocPatch(boardId, {
      upserts: { pages: [{ id: pageId, name: "Renamed", shapeIds: [] }] },
    });
    expect((await repo.loadDoc(boardId)).pages[pageId].name).toBe("Renamed");
    expect(repo.getSessionStatus()?.dirty).toBe(false);

    await repo.undo();
    expect((await repo.loadDoc(boardId)).pages[pageId].name).toBe("Page 1");
    await repo.redo();
    expect((await repo.loadDoc(boardId)).pages[pageId].name).toBe("Renamed");

    await repo.closeSession();
    const boards = await repo.listBoards();
    await repo.openBoard(boards[0].id);
    expect((await repo.loadDoc(boards[0].id)).pages[pageId].name).toBe("Renamed");
    await repo.closeSession();
    const reopened = await repo.loadDoc(boards[0].id);
    expect(reopened.pages[pageId].name).toBe("Renamed");
  });

  it("lists canonical and legacy paths without reading document bytes in the frontend", async () => {
    fileOps.setWorkspace("/workspace");
    fileOps.setEntries([
      { path: "/workspace/alpha.inkfinite", name: "alpha.inkfinite", isDir: false },
      { path: "/workspace/beta.inkfinite.json", name: "beta.inkfinite.json", isDir: false },
      { path: "/workspace/assets", name: "assets", isDir: true },
    ]);
    const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });

    const boards = await repo.listBoards();

    expect(boards.map((board) => board.name)).toEqual(["alpha", "beta"]);
    expect(boards.every((board) => board.id.startsWith("path:"))).toBe(true);
  });
});
