import {
  createStatusStore,
  type EditorPlatformAdapter,
} from "@inkfinite/ui/editor";
import { InkfiniteDB } from "$lib/persistence/database";
import { createDexieDocRepo, createPersistenceSink } from "$lib/persistence/repository";

export function createTestPlatformAdapter(): EditorPlatformAdapter {
  return {
    kind: "web",
    async connect() {
      const repo = createDexieDocRepo(new InkfiniteDB());
      return {
        repo,
        sink: createPersistenceSink(repo),
        status: createStatusStore({ backend: "indexeddb", state: "saved", pendingWrites: 0 }),
      };
    },
  };
}
