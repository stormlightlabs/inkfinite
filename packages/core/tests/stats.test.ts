import { describe, expect, it } from "vitest";
import { BoardStatsOps } from "../src/persistence/stats";

describe("BoardStatsOps", () => {
  describe("create", () => {
    it("creates board stats with provided values", () => {
      const stats = BoardStatsOps.create({
        pageCount: 5,
        shapeCount: 20,
        bindingCount: 3,
        docSizeBytes: 1024,
        lastUpdated: 1234567890,
      });

      expect(stats).toMatchObject({
        pageCount: 5,
        shapeCount: 20,
        bindingCount: 3,
        docSizeBytes: 1024,
        lastUpdated: 1234567890,
      });
    });

    it("handles zero values", () => {
      const stats = BoardStatsOps.create({
        pageCount: 0,
        shapeCount: 0,
        bindingCount: 0,
        docSizeBytes: 0,
        lastUpdated: 0,
      });

      expect(stats.pageCount).toBe(0);
      expect(stats.shapeCount).toBe(0);
      expect(stats.bindingCount).toBe(0);
      expect(stats.docSizeBytes).toBe(0);
    });
  });

  describe("formatDocSize", () => {
    it("formats bytes correctly", () => {
      expect(BoardStatsOps.formatDocSize(0)).toBe("0 B");
      expect(BoardStatsOps.formatDocSize(100)).toBe("100 B");
      expect(BoardStatsOps.formatDocSize(1023)).toBe("1023 B");
    });

    it("formats kilobytes correctly", () => {
      expect(BoardStatsOps.formatDocSize(1024)).toBe("1.0 KB");
      expect(BoardStatsOps.formatDocSize(1536)).toBe("1.5 KB");
      expect(BoardStatsOps.formatDocSize(10240)).toBe("10.0 KB");
    });

    it("formats megabytes correctly", () => {
      expect(BoardStatsOps.formatDocSize(1024 * 1024)).toBe("1.0 MB");
      expect(BoardStatsOps.formatDocSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
      expect(BoardStatsOps.formatDocSize(10 * 1024 * 1024)).toBe("10.0 MB");
    });

    it("rounds to one decimal place", () => {
      expect(BoardStatsOps.formatDocSize(1234)).toBe("1.2 KB");
      expect(BoardStatsOps.formatDocSize(1567)).toBe("1.5 KB");
      expect(BoardStatsOps.formatDocSize(1234567)).toBe("1.2 MB");
    });
  });
});
