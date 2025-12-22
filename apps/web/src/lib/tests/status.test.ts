import type { Observable, Observer, Subscription } from "dexie";
import type { DocPatch, DocRepo, InkfiniteDB, PageRecord } from "inkfinite-core";
import { describe, expect, it, vi } from "vitest";
import { createPersistenceManager, type PersistenceManagerOptions } from "../status";

function createMockRepo(): DocRepo {
  return {
    listBoards: vi.fn(async () => []),
    createBoard: vi.fn(async () => "board:mock"),
    renameBoard: vi.fn(async () => {}),
    deleteBoard: vi.fn(async () => {}),
    loadDoc: vi.fn(async () => ({ pages: {}, shapes: {}, bindings: {}, order: { pageIds: [], shapeOrder: {} } })),
    applyDocPatch: vi.fn(async () => {}),
    exportBoard: vi.fn(async () => ({
      board: { id: "board:mock", name: "", createdAt: 0, updatedAt: 0 },
      doc: { pages: {}, shapes: {}, bindings: {} },
      order: { pageIds: [], shapeOrder: {} },
    })),
    importBoard: vi.fn(async () => "board:mock"),
  };
}

type ObserverLike = { next: (value: any) => void; error?: (err: unknown) => void };

function createMockLiveQuery() {
  const observers = new Set<ObserverLike>();
  const factory: PersistenceManagerOptions["liveQueryFn"] = () => {
    const observable: Observable<any> = {
      subscribe(observer?: Observer<any> | ((value: any) => void) | null) {
        const normalized: ObserverLike = typeof observer === "function"
          ? { next: observer }
          : observer
          ? { next: observer.next ?? (() => {}), error: observer.error }
          : { next: () => {} };
        observers.add(normalized);
        const subscription = {
          closed: false,
          unsubscribe() {
            if (subscription.closed) {
              return;
            }
            subscription.closed = true;
            observers.delete(normalized);
          },
        };
        return subscription as Subscription;
      },
      [Symbol.observable]() {
        return this;
      },
    };
    return observable;
  };

  return {
    factory,
    emit(value: any) {
      for (const observer of observers) {
        observer.next(value);
      }
    },
    error(err: unknown) {
      for (const observer of observers) {
        observer.error?.(err);
      }
    },
    observerCount() {
      return observers.size;
    },
  };
}

function createStatusTracker(
  overrides?: { repo?: DocRepo; options?: PersistenceManagerOptions; db?: Partial<InkfiniteDB> },
) {
  const repo = overrides?.repo ?? createMockRepo();
  const live = overrides?.options?.liveQueryFn ? null : createMockLiveQuery();
  const options: PersistenceManagerOptions = overrides?.options ?? { liveQueryFn: live?.factory };
  const db = (overrides?.db ?? { boards: { get: vi.fn(async () => undefined) } }) as InkfiniteDB;
  const manager = createPersistenceManager(db, repo, options);
  const mock = { repo, live, manager };
  return mock;
}

function buildPatch(): DocPatch {
  return { upserts: { pages: [{ id: "page:1", name: "Page 1", shapeIds: [] } as PageRecord] } };
}

describe("createPersistenceManager", () => {
  it("tracks pending writes and resets when liveQuery emits", () => {
    const { live, manager } = createStatusTracker();
    expect(manager.status.get().pendingWrites).toBe(0);
    manager.setActiveBoard("board:1");

    manager.sink.enqueueDocPatch("board:1", buildPatch());
    let status = manager.status.get();
    expect(status.state).toBe("saving");
    expect(status.pendingWrites).toBe(1);

    live?.emit({ updatedAt: 123 });
    status = manager.status.get();
    expect(status.pendingWrites).toBe(0);
    expect(status.state).toBe("saved");
    expect(status.lastSavedAt).toBe(123);
  });

  it("records errors from flush", async () => {
    const repo = createMockRepo();
    (repo.applyDocPatch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("failed"));
    const { manager } = createStatusTracker({ repo });
    manager.setActiveBoard("board:1");
    manager.sink.enqueueDocPatch("board:1", buildPatch());

    await expect(manager.sink.flush()).rejects.toThrow("failed");
    expect(manager.status.get().state).toBe("error");
    expect(manager.status.get().errorMsg).toBe("failed");
  });

  it("stops liveQuery when disposed", () => {
    const live = createMockLiveQuery();
    const { manager } = createStatusTracker({ options: { liveQueryFn: live.factory } });
    manager.setActiveBoard("board:1");
    expect(live.observerCount()).toBe(1);
    manager.dispose();
    expect(live.observerCount()).toBe(0);
  });
});
