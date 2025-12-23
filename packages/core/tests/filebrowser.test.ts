import { describe, expect, it, vi } from "vitest";
import type { DocRepo } from "../src/persist/DocRepo";
import { FileBrowserVM } from "../src/ui/filebrowser";

function createRepoMock(): DocRepo {
  return {
    listBoards: vi.fn(async () => []),
    createBoard: vi.fn(async () => "board:new"),
    openBoard: vi.fn(async () => {}),
    renameBoard: vi.fn(async () => {}),
    deleteBoard: vi.fn(async () => {}),
  };
}

const boards = [{ id: "board:alpha", name: "Alpha Board", createdAt: 1, updatedAt: 10 }, {
  id: "board:beta",
  name: "Beta Board",
  createdAt: 2,
  updatedAt: 20,
}, { id: "board:gamma", name: "Gamma", createdAt: 3, updatedAt: 30 }];

describe("FileBrowserVM", () => {
  it("filters boards by query and maintains selection", () => {
    const repo = createRepoMock();
    const vm = FileBrowserVM.create({ repo, boards });
    expect(vm.filteredBoards).toHaveLength(3);
    expect(vm.selectedId).toBe("board:alpha");

    const betaOnly = FileBrowserVM.setQuery(vm, "beta");
    expect(betaOnly.filteredBoards).toHaveLength(1);
    expect(betaOnly.filteredBoards[0].id).toBe("board:beta");
    expect(betaOnly.selectedId).toBe("board:beta");
  });

  it("updates boards list immutably", () => {
    const repo = createRepoMock();
    const vm = FileBrowserVM.create({ repo, boards: boards.slice(0, 2) });
    const next = FileBrowserVM.setBoards(vm, boards);
    expect(next.boards).toHaveLength(3);
    expect(next.filteredBoards).toHaveLength(3);
    expect(next).not.toBe(vm);
  });

  it("selects the first available board when selection is invalid", () => {
    const repo = createRepoMock();
    const vm = FileBrowserVM.create({ repo, boards });
    const betaOnly = FileBrowserVM.setQuery(vm, "beta");
    const updated = FileBrowserVM.select(betaOnly, "missing");
    expect(updated.selectedId).toBe("board:beta");
  });

  it("invokes repo actions", async () => {
    const repo = createRepoMock();
    const vm = FileBrowserVM.create({ repo, boards });

    await vm.actions.open("board:alpha");
    expect(repo.openBoard).toHaveBeenCalledWith("board:alpha");

    await vm.actions.create("Untitled");
    expect(repo.createBoard).toHaveBeenCalledWith("Untitled");

    await vm.actions.rename("board:alpha", "Renamed");
    expect(repo.renameBoard).toHaveBeenCalledWith("board:alpha", "Renamed");

    await vm.actions.delete("board:alpha");
    expect(repo.deleteBoard).toHaveBeenCalledWith("board:alpha");
  });
});
