import FileBrowser from "$lib/filebrowser/FileBrowser.svelte";
import type { BoardMeta, FileBrowserViewModel } from "inkfinite-core";
import { FileBrowserVM } from "inkfinite-core";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";

const mockRepo = {
  listBoards: vi.fn(),
  createBoard: vi.fn(),
  openBoard: vi.fn(),
  renameBoard: vi.fn(),
  deleteBoard: vi.fn(),
};

function createMockBoards(): BoardMeta[] {
  return [{ id: "board-1", name: "Board 1", createdAt: 1000, updatedAt: 2000 }, {
    id: "board-2",
    name: "Board 2",
    createdAt: 1500,
    updatedAt: 2500,
  }, { id: "board-3", name: "Test Board", createdAt: 2000, updatedAt: 3000 }];
}

function createMockVM(boards: BoardMeta[]): FileBrowserViewModel {
  return FileBrowserVM.create({ repo: mockRepo, boards });
}

describe("FileBrowser", () => {
  describe("boards list", () => {
    it("should render boards when provided", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);

      render(FileBrowser, { vm, open: true });

      await expect.element(page.getByText("Board 1")).toBeVisible();
      await expect.element(page.getByText("Board 2")).toBeVisible();
      await expect.element(page.getByText("Test Board")).toBeVisible();
    });

    it("should show empty state when no boards", async () => {
      const vm = createMockVM([]);

      render(FileBrowser, { vm, open: true });

      await expect.element(page.getByText("No boards yet")).toBeVisible();
    });

    it("should show filtered empty state when query has no matches", async () => {
      const boards = createMockBoards();
      const vm = FileBrowserVM.setQuery(createMockVM(boards), "NonExistent");

      render(FileBrowser, { vm, open: true });

      await expect.element(page.getByText("No boards match your search")).toBeVisible();
    });
  });

  describe("search functionality", () => {
    it("should have search input", async () => {
      const vm = createMockVM(createMockBoards());

      render(FileBrowser, { vm, open: true });

      const searchInput = page.getByPlaceholder("Search boards...");
      await expect.element(searchInput).toBeInTheDocument();
    });

    it("should update query on input", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);
      const onUpdate = vi.fn();

      render(FileBrowser, { vm, open: true, onUpdate });

      const searchInput = page.getByPlaceholder("Search boards...");
      await searchInput.fill("Test");

      await expect.poll(() => searchInput.query()).toHaveValue("Test");
    });
  });

  describe("board actions", () => {
    it("should show create board button", async () => {
      const vm = createMockVM(createMockBoards());

      render(FileBrowser, { vm, open: true });

      const createButton = page.getByRole("button", { name: /create new board/i });
      await expect.element(createButton).toBeVisible();
    });

    it("should show create form when new button is clicked", async () => {
      const vm = createMockVM(createMockBoards());

      render(FileBrowser, { vm, open: true });

      const newButton = page.getByRole("button", { name: /create new board/i });
      await newButton.click();

      await expect.element(page.getByPlaceholder("Board name")).toBeVisible();
      await expect.element(page.getByRole("button", { name: /^create$/i })).toBeVisible();
    });

    it("should have inspect buttons for each board", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);

      render(FileBrowser, { vm, open: true });

      const inspectButtons = page.getByLabelText(/inspect board/i);
      await expect.poll(() => inspectButtons.all()).toHaveLength(3);
    });

    it("should have rename buttons for each board", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);

      render(FileBrowser, { vm, open: true });

      const renameButtons = page.getByLabelText(/rename board/i);
      await expect.poll(() => renameButtons.all()).toHaveLength(3);
    });

    it("should have delete buttons for each board", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);

      render(FileBrowser, { vm, open: true });

      const deleteButtons = page.getByLabelText(/delete board/i);
      await expect.poll(() => deleteButtons.all()).toHaveLength(3);
    });
  });

  describe("inspector drawer", () => {
    it("should not show inspector initially", async () => {
      const vm = createMockVM(createMockBoards());

      render(FileBrowser, { vm, open: true });

      await expect.poll(() => document.querySelector(".inspector__title")).toBeNull();
    });

    it("should show inspector when inspect button is clicked", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);
      const fetchInspectorData = vi.fn().mockResolvedValue({
        stats: { pageCount: 2, shapeCount: 10, bindingCount: 3, docSizeBytes: 2048, lastUpdated: 3000 },
        schema: { declaredVersion: 1, installedVersion: 1 },
        migrations: [{ id: "MIG-0001", appliedAt: 1000 }, { id: "MIG-0002", appliedAt: 2000 }],
        pendingMigrations: [],
      });

      render(FileBrowser, { vm, open: true, fetchInspectorData });

      const inspectButtons = page.getByLabelText(/inspect board/i);
      const buttons = inspectButtons.all();
      const firstButton = buttons[0];
      await firstButton.click();

      await expect.element(page.getByText("Board Inspector")).toBeVisible();
    });

    it("should display board statistics in inspector", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);
      const fetchInspectorData = vi.fn().mockResolvedValue({
        stats: { pageCount: 2, shapeCount: 10, bindingCount: 3, docSizeBytes: 2048, lastUpdated: 3000 },
        schema: { declaredVersion: 1, installedVersion: 1 },
        migrations: [],
        pendingMigrations: [],
      });

      render(FileBrowser, { vm, open: true, fetchInspectorData });

      const inspectButtons = page.getByLabelText(/inspect board/i);
      const buttons = inspectButtons.all();
      const firstButton = buttons[0];
      await firstButton.click();

      await expect.element(page.getByText("Statistics")).toBeVisible();

      await expect.element(page.getByText("Pages:")).toBeVisible();
      await expect.element(page.getByText("Shapes:")).toBeVisible();
      await expect.element(page.getByText("Bindings:")).toBeVisible();
    });

    it("should display schema information in inspector", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);
      const fetchInspectorData = vi.fn().mockResolvedValue({
        stats: { pageCount: 2, shapeCount: 10, bindingCount: 3, docSizeBytes: 2048, lastUpdated: 3000 },
        schema: { declaredVersion: 1, installedVersion: 1 },
        migrations: [],
        pendingMigrations: [],
      });

      render(FileBrowser, { vm, open: true, fetchInspectorData });

      const inspectButtons = page.getByLabelText(/inspect board/i);
      const buttons = inspectButtons.all();
      const firstButton = buttons[0];
      await firstButton.click();

      await expect.element(page.getByText("Schema")).toBeVisible();
      await expect.element(page.getByText("Declared Version:")).toBeVisible();
      await expect.element(page.getByText("Installed Version:")).toBeVisible();
    });

    it("should display migrations in inspector", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);
      const fetchInspectorData = vi.fn().mockResolvedValue({
        stats: { pageCount: 2, shapeCount: 10, bindingCount: 3, docSizeBytes: 2048, lastUpdated: 3000 },
        schema: { declaredVersion: 1, installedVersion: 1 },
        migrations: [{ id: "MIG-0001", appliedAt: 1000 }, { id: "MIG-0002", appliedAt: 2000 }],
        pendingMigrations: [],
      });

      render(FileBrowser, { vm, open: true, fetchInspectorData });

      const inspectButtons = page.getByLabelText(/inspect board/i);
      const buttons = inspectButtons.all();
      const firstButton = buttons[0];
      await firstButton.click();

      await expect.element(page.getByText("Migrations")).toBeVisible();
      await expect.element(page.getByText("MIG-0001")).toBeVisible();
      await expect.element(page.getByText("MIG-0002")).toBeVisible();
    });

    it("should show pending migrations warning when present", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);
      const fetchInspectorData = vi.fn().mockResolvedValue({
        stats: { pageCount: 2, shapeCount: 10, bindingCount: 3, docSizeBytes: 2048, lastUpdated: 3000 },
        schema: { declaredVersion: 1, installedVersion: 1 },
        migrations: [{ id: "MIG-0001", appliedAt: 1000 }],
        pendingMigrations: ["MIG-0002", "MIG-0003"],
      });

      render(FileBrowser, { vm, open: true, fetchInspectorData });

      const inspectButtons = page.getByLabelText(/inspect board/i);
      const buttons = inspectButtons.all();
      const firstButton = buttons[0];
      await firstButton.click();

      await expect.element(page.getByText(/Pending Migrations:/i)).toBeVisible();
      await expect.element(page.getByText("MIG-0002")).toBeVisible();
      await expect.element(page.getByText("MIG-0003")).toBeVisible();
    });

    it("should show error when inspector data fetch fails", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);
      const fetchInspectorData = vi.fn().mockRejectedValue(new Error("Failed to fetch"));

      render(FileBrowser, { vm, open: true, fetchInspectorData });

      const inspectButtons = page.getByLabelText(/inspect board/i);
      const buttons = inspectButtons.all();
      const firstButton = buttons[0];
      await firstButton.click();

      await expect.element(page.getByText("Failed to fetch")).toBeVisible();
    });
  });

  describe("callbacks", () => {
    it("should call onUpdate when search changes", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);
      const onUpdate = vi.fn();

      render(FileBrowser, { vm, open: true, onUpdate });

      const searchInput = page.getByPlaceholder("Search boards...");
      await searchInput.fill("Test");

      const input = document.querySelector("[placeholder=\"Search boards...\"]") as HTMLInputElement;
      input?.dispatchEvent(new Event("change", { bubbles: true }));

      await expect.poll(() => onUpdate).toHaveBeenCalled();
    });

    it("should call onClose when board is opened", async () => {
      const boards = createMockBoards();
      const vm = createMockVM(boards);
      const onClose = vi.fn();

      mockRepo.openBoard.mockResolvedValue(undefined);

      render(FileBrowser, { vm, open: true, onClose });

      const boardName = page.getByText("Board 1");
      await boardName.click();

      await expect.poll(() => mockRepo.openBoard).toHaveBeenCalledWith("board-1");
      await expect.poll(() => onClose).toHaveBeenCalled();
    });
  });
});
