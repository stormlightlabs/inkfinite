import { liveQuery } from "dexie";
import {
  createPersistenceSink,
  type DocPatch,
  type DocRepo,
  type PersistenceSink,
  type PersistenceSinkOptions,
} from "inkfinite-core";
import type { InkfiniteDB, PersistenceStatus } from "inkfinite-core";

type StatusListener = (status: PersistenceStatus) => void;

export type StatusStore = {
  get(): PersistenceStatus;
  subscribe(listener: StatusListener): () => void;
  update(updater: (status: PersistenceStatus) => PersistenceStatus): void;
};

type LiveQueryFactory = typeof liveQuery;

export type PersistenceManagerOptions = { sink?: PersistenceSinkOptions; liveQueryFn?: LiveQueryFactory };

export type PersistenceManager = {
  sink: PersistenceSink;
  status: StatusStore;
  setActiveBoard(boardId: string | null): void;
  dispose(): void;
};

export function createPersistenceManager(
  db: InkfiniteDB,
  repo: DocRepo,
  options?: PersistenceManagerOptions,
): PersistenceManager {
  const sink = createPersistenceSink(repo, options?.sink);
  const status = createStatusStore({ backend: "indexeddb", state: "saved", pendingWrites: 0 });

  let activeBoardId: string | null = null;
  let subscription: { unsubscribe(): void } | null = null;
  const liveQueryFactory = options?.liveQueryFn ?? liveQuery;

  function incrementPending() {
    status.update((current) => ({
      ...current,
      pendingWrites: (current.pendingWrites ?? 0) + 1,
      state: "saving",
      lastError: undefined,
    }));
  }

  function markSaved(timestamp?: number) {
    status.update((current) => ({
      ...current,
      pendingWrites: 0,
      state: "saved",
      lastSavedAt: timestamp ?? current.lastSavedAt,
      errorMsg: undefined,
    }));
  }

  function markError(error: unknown) {
    status.update((current) => ({
      ...current,
      state: "error",
      errorMsg: error instanceof Error ? error.message : String(error),
    }));
  }

  function setActiveBoard(boardId: string | null) {
    if (activeBoardId === boardId) {
      return;
    }

    subscription?.unsubscribe();
    subscription = null;
    activeBoardId = boardId;

    if (!boardId) {
      return;
    }

    const observable = liveQueryFactory(() => db.boards.get(boardId));
    subscription = observable.subscribe({
      next(board) {
        if (board?.updatedAt !== undefined) {
          markSaved(board.updatedAt);
        }
      },
      error(err) {
        markError(err);
      },
    });
  }

  const trackedSink: PersistenceSink = {
    enqueueDocPatch(boardId, patch) {
      if (hasPatchChanges(patch)) {
        incrementPending();
      }
      sink.enqueueDocPatch(boardId, patch);
    },
    async flush() {
      try {
        await sink.flush();
      } catch (error) {
        markError(error);
        throw error;
      }
    },
  };

  return {
    sink: trackedSink,
    status,
    setActiveBoard,
    dispose() {
      subscription?.unsubscribe();
      subscription = null;
    },
  };
}

function createStatusStore(initial: PersistenceStatus): StatusStore {
  let value = initial;
  const listeners = new Set<StatusListener>();

  return {
    get() {
      return value;
    },
    subscribe(listener: StatusListener) {
      listeners.add(listener);
      listener(value);
      return () => {
        listeners.delete(listener);
      };
    },
    update(updater) {
      value = updater(value);
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
}

function hasPatchChanges(patch: DocPatch): boolean {
  const upserts = patch.upserts;
  if (upserts?.pages?.length || upserts?.shapes?.length || upserts?.bindings?.length) {
    return true;
  }

  const deletes = patch.deletes;
  if (deletes?.pageIds?.length || deletes?.shapeIds?.length || deletes?.bindingIds?.length) {
    return true;
  }

  if (patch.order) {
    if (patch.order.pageIds?.length) {
      return true;
    }
    if (patch.order.shapeOrder && Object.keys(patch.order.shapeOrder).length > 0) {
      return true;
    }
  }

  return false;
}
