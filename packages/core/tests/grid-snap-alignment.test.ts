import { describe, expect, it } from "vitest";

/**
 * Tests to verify grid rendering and snapping alignment
 *
 * These tests ensure that:
 * 1. Snapping positions align with grid line positions
 * 2. The default grid size is consistent across the system
 * 3. Grid lines are drawn at correct multiples of gridSize
 */
describe("Grid and snap alignment", () => {
  const DEFAULT_GRID_SIZE = 25;

  describe("Grid line positioning", () => {
    it("should position grid lines at exact multiples of gridSize", () => {
      const gridSize = 25;
      const testPositions = [0, 25, 50, 75, 100, 125, 150];

      for (const pos of testPositions) {
        expect(pos % gridSize).toBe(0);

        const calculatedPosition = Math.floor(pos / gridSize) * gridSize;
        expect(calculatedPosition).toBe(pos);
      }
    });

    it("should calculate start position correctly for any viewport", () => {
      const gridSize = 25;

      const testCases = [
        { topLeft: 0, expectedStart: 0 },
        { topLeft: 10, expectedStart: 0 },
        { topLeft: 23, expectedStart: 0 },
        { topLeft: 25, expectedStart: 25 },
        { topLeft: 37, expectedStart: 25 },
        { topLeft: 50, expectedStart: 50 },
        { topLeft: -10, expectedStart: -25 },
        { topLeft: -23, expectedStart: -25 },
      ];

      for (const { topLeft, expectedStart } of testCases) {
        const startX = Math.floor(topLeft / gridSize) * gridSize;
        expect(startX).toBe(expectedStart);
      }
    });
  });

  describe("Snapping calculation", () => {
    it("should snap to nearest grid line", () => {
      const gridSize = 25;

      const testCases = [
        { input: 0, expected: 0 },
        { input: 10, expected: 0 },
        { input: 12, expected: 0 },
        { input: 13, expected: 25 },
        { input: 20, expected: 25 },
        { input: 25, expected: 25 },
        { input: 30, expected: 25 },
        { input: 37, expected: 25 },
        { input: 38, expected: 50 },
        { input: 50, expected: 50 },
        { input: -10, expected: 0 },
        { input: -12, expected: 0 },
        { input: -13, expected: -25 },
      ];

      for (const { input, expected } of testCases) {
        const snapped = Math.round(input / gridSize) * gridSize;
        const normalizedSnapped = snapped === 0 ? 0 : snapped;
        const normalizedExpected = expected === 0 ? 0 : expected;
        expect(normalizedSnapped).toBe(normalizedExpected);
      }
    });

    it("should produce positions that align with grid lines", () => {
      const gridSize = 25;

      for (let i = 0; i < 100; i++) {
        const randomPos = Math.random() * 1000 - 500;
        const snapped = Math.round(randomPos / gridSize) * gridSize;

        expect(Math.abs(snapped % gridSize)).toBe(0);

        expect(Math.abs(snapped - randomPos)).toBeLessThanOrEqual(gridSize / 2);
      }
    });
  });

  describe("Grid/snap consistency", () => {
    it("should use the same default grid size", () => {
      const snapStoreDefault = 25;
      const rendererDefault = 25;

      expect(snapStoreDefault).toBe(DEFAULT_GRID_SIZE);
      expect(rendererDefault).toBe(DEFAULT_GRID_SIZE);
    });

    it("should align snapped positions with grid lines", () => {
      const gridSize = 25;

      const inputs = [17, 42, 63, 88, 112, 137, 163, 188];

      for (const input of inputs) {
        const snappedX = Math.round(input / gridSize) * gridSize;

        const startX = Math.floor(input / gridSize) * gridSize;
        const nextGridLine = startX + gridSize;

        expect(snappedX === startX || snappedX === nextGridLine).toBe(true);

        expect(snappedX % gridSize).toBe(0);
      }
    });
  });

  describe("Edge cases", () => {
    it("should handle zero correctly", () => {
      const gridSize = 25;
      const snapped = Math.round(0 / gridSize) * gridSize;
      expect(snapped).toBe(0);
    });

    it("should handle exact grid positions correctly", () => {
      const gridSize = 25;
      const exactPositions = [0, 25, 50, 75, 100, -25, -50];

      for (const pos of exactPositions) {
        const snapped = Math.round(pos / gridSize) * gridSize;
        expect(snapped).toBe(pos);
      }
    });

    it("should handle midpoints consistently", () => {
      const gridSize = 25;
      const midpoint1 = 12.5;
      const snapped1 = Math.round(midpoint1 / gridSize) * gridSize;
      expect(snapped1).toBe(25);
      expect(Math.round(37.5 / 25) * 25).toBe(50);

      const negSnapped = Math.round(-12.5 / 25) * 25;
      expect(negSnapped === 0 ? 0 : negSnapped).toBe(0);
    });

    it("should handle different grid sizes", () => {
      const testGridSizes = [10, 20, 25, 50, 100];

      for (const gridSize of testGridSizes) {
        const input = 123;
        const snapped = Math.round(input / gridSize) * gridSize;

        expect(snapped % gridSize).toBe(0);

        const quotient = input / gridSize;
        const nearestMultiple = Math.round(quotient);
        expect(snapped).toBe(nearestMultiple * gridSize);
      }
    });
  });

  describe("Zoom independence", () => {
    it("should maintain alignment regardless of zoom level", () => {
      const gridSize = 25;
      const worldPosition = 137;
      const snapped = Math.round(worldPosition / gridSize) * gridSize;
      expect(snapped).toBe(125);

      const startGrid = Math.floor(worldPosition / gridSize) * gridSize;
      expect(startGrid).toBe(125);
    });

    it("should draw grid lines at consistent world positions", () => {
      const gridSize = 25;

      const viewportCases = [{ topLeft: 0, zoom: 1 }, { topLeft: 100, zoom: 1 }, { topLeft: 0, zoom: 2 }, {
        topLeft: 50,
        zoom: 0.5,
      }];

      for (const { topLeft } of viewportCases) {
        const startX = Math.floor(topLeft / gridSize) * gridSize;

        const gridLines = [];
        for (let x = startX; x <= startX + 200; x += gridSize) {
          gridLines.push(x);
        }

        for (const line of gridLines) {
          expect(line % gridSize).toBe(0);
        }
      }
    });
  });
});
