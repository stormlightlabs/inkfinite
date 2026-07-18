import type { DesktopFileOps } from "@inkfinite/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDesktopSessionRepo } from "$lib/persistence/desktop-session";

function createWorkspaceOps() {
  let workspace: string | null = null;
  const ops: DesktopFileOps = {
    async showOpenDialog() {
      return null;
    },
    async showSaveDialog() {
      return "/workspace/new.inkfinite";
    },
    async getRecentFiles() {
      return [];
    },
    async addRecentFile() {},
    async removeRecentFile() {},
    async clearRecentFiles() {},
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
    async readDirectory() {
      return [];
    },
    async renameFile() {},
    async deleteFile() {},
  };
  return { ops, getWorkspace: () => workspace };
}

describe("desktop workspace adapter", () => {
  let fake: ReturnType<typeof createWorkspaceOps>;

  beforeEach(() => {
    fake = createWorkspaceOps();
  });

  it("gets, sets, clears, and picks the workspace directory", async () => {
    const repo = createDesktopSessionRepo(fake.ops, {
      api: {
        createDocument: async () => { throw new Error("not used"); },
        openDocument: async () => { throw new Error("not used"); },
        snapshot: async () => { throw new Error("not used"); },
        commit: async () => { throw new Error("not used"); },
        propose: async () => { throw new Error("not used"); },
        acceptProposal: async () => { throw new Error("not used"); },
        rejectProposal: async () => { throw new Error("not used"); },
        authorizeApply: async () => { throw new Error("not used"); },
        undo: async () => { throw new Error("not used"); },
        redo: async () => { throw new Error("not used"); },
        save: async () => { throw new Error("not used"); },
        saveAs: async () => { throw new Error("not used"); },
        query: async () => { throw new Error("not used"); },
        validate: async () => { throw new Error("not used"); },
        close: async () => {},
      },
    });

    expect(await repo.getWorkspaceDir()).toBeNull();
    await repo.setWorkspaceDir("/workspace");
    expect(fake.getWorkspace()).toBe("/workspace");
    await repo.setWorkspaceDir(null);
    expect(await repo.getWorkspaceDir()).toBeNull();
    expect(await repo.pickWorkspaceDir()).toBe("/workspace");
  });
});
