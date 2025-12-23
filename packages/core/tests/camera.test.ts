import { describe, expect, it } from "vitest";
import { Camera, type Viewport } from "../src/camera";

const viewport: Viewport = { width: 800, height: 600 };

describe("Camera", () => {
  describe("create", () => {
    it("should create camera with default values", () => {
      const camera = Camera.create();
      expect(camera).toEqual({ x: 0, y: 0, zoom: 1 });
    });

    it("should create camera with custom values", () => {
      const camera = Camera.create(100, 200, 2);
      expect(camera).toEqual({ x: 100, y: 200, zoom: 2 });
    });

    it.each([
      { description: "negative position", x: -100, y: -200, zoom: 1 },
      { description: "fractional zoom", x: 0, y: 0, zoom: 0.5 },
      { description: "large zoom", x: 0, y: 0, zoom: 10 },
      { description: "very small zoom", x: 0, y: 0, zoom: 0.01 },
    ])("should handle $description", ({ x, y, zoom }) => {
      const camera = Camera.create(x, y, zoom);
      expect(camera).toEqual({ x, y, zoom });
    });
  });

  describe("clone", () => {
    it("should create a copy of the camera", () => {
      const camera = Camera.create(10, 20, 1.5);
      const cloned = Camera.clone(camera);
      expect(cloned).toEqual(camera);
      expect(cloned).not.toBe(camera);
    });
  });

  describe("equals", () => {
    it.each([
      {
        description: "identical cameras",
        a: Camera.create(10, 20, 1.5),
        b: Camera.create(10, 20, 1.5),
        expected: true,
      },
      { description: "different position", a: Camera.create(10, 20, 1), b: Camera.create(11, 20, 1), expected: false },
      { description: "different zoom", a: Camera.create(10, 20, 1), b: Camera.create(10, 20, 1.1), expected: false },
    ])("should compare $description", ({ a, b, expected }) => {
      expect(Camera.equals(a, b)).toBe(expected);
    });

    it("should use epsilon for floating point comparison", () => {
      const a = Camera.create(10, 20, 1);
      const b = Camera.create(10 + 5e-11, 20 + 5e-11, 1 + 5e-11);
      expect(Camera.equals(a, b)).toBe(true);
    });

    it("should allow custom epsilon", () => {
      const a = Camera.create(10, 20, 1);
      const b = Camera.create(10.005, 20.005, 1.005);
      expect(Camera.equals(a, b, 0.01)).toBe(true);
      expect(Camera.equals(a, b, 0.001)).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset camera to origin with 100% zoom", () => {
      expect(Camera.reset()).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  describe("worldToScreen", () => {
    it.each([{
      description: "camera at origin, point at origin",
      camera: Camera.create(0, 0, 1),
      worldPoint: { x: 0, y: 0 },
      expected: { x: 400, y: 300 },
    }, {
      description: "camera at origin, point to the right",
      camera: Camera.create(0, 0, 1),
      worldPoint: { x: 100, y: 0 },
      expected: { x: 500, y: 300 },
    }, {
      description: "camera at origin, point below",
      camera: Camera.create(0, 0, 1),
      worldPoint: { x: 0, y: 100 },
      expected: { x: 400, y: 400 },
    }, {
      description: "camera offset, point at camera position",
      camera: Camera.create(100, 200, 1),
      worldPoint: { x: 100, y: 200 },
      expected: { x: 400, y: 300 },
    }, {
      description: "zoomed in 2x, point at origin",
      camera: Camera.create(0, 0, 2),
      worldPoint: { x: 100, y: 0 },
      expected: { x: 600, y: 300 },
    }, {
      description: "zoomed out 0.5x, point at origin",
      camera: Camera.create(0, 0, 0.5),
      worldPoint: { x: 100, y: 0 },
      expected: { x: 450, y: 300 },
    }, {
      description: "negative world coordinates",
      camera: Camera.create(0, 0, 1),
      worldPoint: { x: -100, y: -50 },
      expected: { x: 300, y: 250 },
    }, {
      description: "camera and point both negative",
      camera: Camera.create(-100, -100, 1),
      worldPoint: { x: -50, y: -50 },
      expected: { x: 450, y: 350 },
    }])("should handle $description", ({ camera, worldPoint, expected }) => {
      const result = Camera.worldToScreen(camera, worldPoint, viewport);
      expect(result.x).toBeCloseTo(expected.x);
      expect(result.y).toBeCloseTo(expected.y);
    });
  });

  describe("screenToWorld", () => {
    it.each([{
      description: "center of screen",
      camera: Camera.create(0, 0, 1),
      screenPoint: { x: 400, y: 300 },
      expected: { x: 0, y: 0 },
    }, {
      description: "top-left corner",
      camera: Camera.create(0, 0, 1),
      screenPoint: { x: 0, y: 0 },
      expected: { x: -400, y: -300 },
    }, {
      description: "bottom-right corner",
      camera: Camera.create(0, 0, 1),
      screenPoint: { x: 800, y: 600 },
      expected: { x: 400, y: 300 },
    }, {
      description: "with camera offset",
      camera: Camera.create(100, 200, 1),
      screenPoint: { x: 400, y: 300 },
      expected: { x: 100, y: 200 },
    }, {
      description: "with 2x zoom",
      camera: Camera.create(0, 0, 2),
      screenPoint: { x: 600, y: 300 },
      expected: { x: 100, y: 0 },
    }, {
      description: "with 0.5x zoom",
      camera: Camera.create(0, 0, 0.5),
      screenPoint: { x: 450, y: 300 },
      expected: { x: 100, y: 0 },
    }])("should handle $description", ({ camera, screenPoint, expected }) => {
      const result = Camera.screenToWorld(camera, screenPoint, viewport);
      expect(result.x).toBeCloseTo(expected.x);
      expect(result.y).toBeCloseTo(expected.y);
    });
  });

  describe("worldToScreen <-> screenToWorld round-trip", () => {
    const testCases = [
      { description: "origin camera, origin point", camera: Camera.create(0, 0, 1), worldPoint: { x: 0, y: 0 } },
      {
        description: "origin camera, arbitrary point",
        camera: Camera.create(0, 0, 1),
        worldPoint: { x: 123.456, y: -789.012 },
      },
      {
        description: "offset camera, arbitrary point",
        camera: Camera.create(100, 200, 1),
        worldPoint: { x: 50, y: -30 },
      },
      { description: "zoomed in camera", camera: Camera.create(0, 0, 2.5), worldPoint: { x: 100, y: 200 } },
      { description: "zoomed out camera", camera: Camera.create(0, 0, 0.3), worldPoint: { x: 1000, y: 2000 } },
      { description: "complex camera state", camera: Camera.create(-500, 300, 1.7), worldPoint: { x: -123, y: 456 } },
      {
        description: "very large coordinates",
        camera: Camera.create(10_000, -10_000, 1),
        worldPoint: { x: 9999, y: -9999 },
      },
      { description: "very small zoom", camera: Camera.create(0, 0, 0.01), worldPoint: { x: 50_000, y: 30_000 } },
    ];

    it.each(testCases)("should round-trip for $description", ({ camera, worldPoint }) => {
      const screenPoint = Camera.worldToScreen(camera, worldPoint, viewport);
      const backToWorld = Camera.screenToWorld(camera, screenPoint, viewport);

      expect(backToWorld.x).toBeCloseTo(worldPoint.x, 10);
      expect(backToWorld.y).toBeCloseTo(worldPoint.y, 10);
    });

    it("should round-trip in reverse direction", () => {
      const camera = Camera.create(100, 200, 1.5);
      const screenPoint = { x: 250, y: 450 };

      const worldPoint = Camera.screenToWorld(camera, screenPoint, viewport);
      const backToScreen = Camera.worldToScreen(camera, worldPoint, viewport);

      expect(backToScreen.x).toBeCloseTo(screenPoint.x, 10);
      expect(backToScreen.y).toBeCloseTo(screenPoint.y, 10);
    });
  });

  describe("pan", () => {
    it.each([{
      description: "pan right (positive screen delta)",
      camera: Camera.create(0, 0, 1),
      deltaScreen: { x: 100, y: 0 },
      expectedPosition: { x: -100, y: 0 },
    }, {
      description: "pan left (negative screen delta)",
      camera: Camera.create(0, 0, 1),
      deltaScreen: { x: -100, y: 0 },
      expectedPosition: { x: 100, y: 0 },
    }, {
      description: "pan down",
      camera: Camera.create(0, 0, 1),
      deltaScreen: { x: 0, y: 50 },
      expectedPosition: { x: 0, y: -50 },
    }, {
      description: "pan up",
      camera: Camera.create(0, 0, 1),
      deltaScreen: { x: 0, y: -50 },
      expectedPosition: { x: 0, y: 50 },
    }, {
      description: "diagonal pan",
      camera: Camera.create(0, 0, 1),
      deltaScreen: { x: 100, y: 50 },
      expectedPosition: { x: -100, y: -50 },
    }, {
      description: "pan from non-origin",
      camera: Camera.create(200, 300, 1),
      deltaScreen: { x: 50, y: 25 },
      expectedPosition: { x: 150, y: 275 },
    }])("should handle $description", ({ camera, deltaScreen, expectedPosition }) => {
      const newCamera = Camera.pan(camera, deltaScreen);
      expect(newCamera.x).toBeCloseTo(expectedPosition.x);
      expect(newCamera.y).toBeCloseTo(expectedPosition.y);
      expect(newCamera.zoom).toBe(camera.zoom);
    });

    it("should scale pan by zoom level", () => {
      const testCases = [{
        description: "zoomed in 2x (smaller world movement)",
        camera: Camera.create(0, 0, 2),
        deltaScreen: { x: 100, y: 0 },
        expectedPosition: { x: -50, y: 0 },
      }, {
        description: "zoomed out 0.5x (larger world movement)",
        camera: Camera.create(0, 0, 0.5),
        deltaScreen: { x: 100, y: 0 },
        expectedPosition: { x: -200, y: 0 },
      }, {
        description: "zoomed in 4x",
        camera: Camera.create(0, 0, 4),
        deltaScreen: { x: 80, y: 40 },
        expectedPosition: { x: -20, y: -10 },
      }];

      for (const { camera, deltaScreen, expectedPosition } of testCases) {
        const newCamera = Camera.pan(camera, deltaScreen);
        expect(newCamera.x).toBeCloseTo(expectedPosition.x);
        expect(newCamera.y).toBeCloseTo(expectedPosition.y);
      }
    });

    it("should verify pan moves world under cursor correctly", () => {
      const camera = Camera.create(0, 0, 1);
      const cursorScreen = { x: 300, y: 200 };
      const worldBefore = Camera.screenToWorld(camera, cursorScreen, viewport);

      const deltaScreen = { x: 50, y: 30 };
      const newCamera = Camera.pan(camera, deltaScreen);

      const worldAfter = Camera.screenToWorld(newCamera, cursorScreen, viewport);

      expect(worldAfter.x - worldBefore.x).toBeCloseTo(-50);
      expect(worldAfter.y - worldBefore.y).toBeCloseTo(-30);
    });
  });

  describe("zoomAt", () => {
    it.each([{
      description: "zoom in 2x at center",
      camera: Camera.create(0, 0, 1),
      factor: 2,
      anchorScreen: { x: 400, y: 300 },
      expectedZoom: 2,
    }, {
      description: "zoom out 0.5x at center",
      camera: Camera.create(0, 0, 1),
      factor: 0.5,
      anchorScreen: { x: 400, y: 300 },
      expectedZoom: 0.5,
    }, {
      description: "zoom in 1.5x at center",
      camera: Camera.create(0, 0, 1),
      factor: 1.5,
      anchorScreen: { x: 400, y: 300 },
      expectedZoom: 1.5,
    }, {
      description: "compound zoom",
      camera: Camera.create(0, 0, 2),
      factor: 1.5,
      anchorScreen: { x: 400, y: 300 },
      expectedZoom: 3,
    }])("should update zoom for $description", ({ camera, factor, anchorScreen, expectedZoom }) => {
      const newCamera = Camera.zoomAt(camera, factor, anchorScreen, viewport);
      expect(newCamera.zoom).toBeCloseTo(expectedZoom);
    });

    it("should keep anchor point stable when zooming at center", () => {
      const camera = Camera.create(0, 0, 1);
      const anchorScreen = { x: 400, y: 300 };

      const newCamera = Camera.zoomAt(camera, 2, anchorScreen, viewport);

      const anchorWorldBefore = Camera.screenToWorld(camera, anchorScreen, viewport);
      const anchorWorldAfter = Camera.screenToWorld(newCamera, anchorScreen, viewport);

      expect(anchorWorldBefore.x).toBeCloseTo(anchorWorldAfter.x);
      expect(anchorWorldBefore.y).toBeCloseTo(anchorWorldAfter.y);

      const anchorScreenAfter = Camera.worldToScreen(newCamera, anchorWorldBefore, viewport);
      expect(anchorScreenAfter.x).toBeCloseTo(anchorScreen.x);
      expect(anchorScreenAfter.y).toBeCloseTo(anchorScreen.y);
    });

    it("should keep anchor point stable when zooming at corner", () => {
      const camera = Camera.create(0, 0, 1);
      const anchorScreen = { x: 100, y: 150 };
      const anchorWorldBefore = Camera.screenToWorld(camera, anchorScreen, viewport);
      const newCamera = Camera.zoomAt(camera, 2, anchorScreen, viewport);

      const anchorScreenAfter = Camera.worldToScreen(newCamera, anchorWorldBefore, viewport);
      expect(anchorScreenAfter.x).toBeCloseTo(anchorScreen.x);
      expect(anchorScreenAfter.y).toBeCloseTo(anchorScreen.y);
    });

    it("should keep anchor point stable when zooming at bottom-right", () => {
      const camera = Camera.create(0, 0, 1);
      const anchorScreen = { x: 700, y: 550 };

      const anchorWorldBefore = Camera.screenToWorld(camera, anchorScreen, viewport);
      const newCamera = Camera.zoomAt(camera, 0.5, anchorScreen, viewport);
      const anchorScreenAfter = Camera.worldToScreen(newCamera, anchorWorldBefore, viewport);

      expect(anchorScreenAfter.x).toBeCloseTo(anchorScreen.x, 5);
      expect(anchorScreenAfter.y).toBeCloseTo(anchorScreen.y, 5);
    });

    it("should keep anchor stable with offset camera", () => {
      const camera = Camera.create(100, 200, 1.5);
      const anchorScreen = { x: 250, y: 400 };

      const anchorWorldBefore = Camera.screenToWorld(camera, anchorScreen, viewport);
      const newCamera = Camera.zoomAt(camera, 2, anchorScreen, viewport);
      const anchorScreenAfter = Camera.worldToScreen(newCamera, anchorWorldBefore, viewport);

      expect(anchorScreenAfter.x).toBeCloseTo(anchorScreen.x, 5);
      expect(anchorScreenAfter.y).toBeCloseTo(anchorScreen.y, 5);
    });

    it("should handle multiple zoom operations correctly", () => {
      let camera = Camera.create(0, 0, 1);
      const anchorScreen = { x: 300, y: 250 };

      const anchorWorld = Camera.screenToWorld(camera, anchorScreen, viewport);

      camera = Camera.zoomAt(camera, 2, anchorScreen, viewport);
      let anchorScreenAfter = Camera.worldToScreen(camera, anchorWorld, viewport);
      expect(anchorScreenAfter.x).toBeCloseTo(anchorScreen.x, 5);
      expect(anchorScreenAfter.y).toBeCloseTo(anchorScreen.y, 5);

      camera = Camera.zoomAt(camera, 1.5, anchorScreen, viewport);
      anchorScreenAfter = Camera.worldToScreen(camera, anchorWorld, viewport);
      expect(anchorScreenAfter.x).toBeCloseTo(anchorScreen.x, 5);
      expect(anchorScreenAfter.y).toBeCloseTo(anchorScreen.y, 5);

      expect(camera.zoom).toBeCloseTo(3, 5);
    });

    it("should handle zoom out correctly", () => {
      const camera = Camera.create(100, 100, 2);
      const anchorScreen = { x: 500, y: 400 };

      const anchorWorld = Camera.screenToWorld(camera, anchorScreen, viewport);
      const newCamera = Camera.zoomAt(camera, 0.5, anchorScreen, viewport);
      const anchorScreenAfter = Camera.worldToScreen(newCamera, anchorWorld, viewport);

      expect(anchorScreenAfter.x).toBeCloseTo(anchorScreen.x, 5);
      expect(anchorScreenAfter.y).toBeCloseTo(anchorScreen.y, 5);
      expect(newCamera.zoom).toBeCloseTo(1, 5);
    });
  });

  describe("clampZoom", () => {
    it.each([
      { description: "within bounds", camera: Camera.create(0, 0, 1), minZoom: 0.1, maxZoom: 10, expectedZoom: 1 },
      { description: "below minimum", camera: Camera.create(0, 0, 0.05), minZoom: 0.1, maxZoom: 10, expectedZoom: 0.1 },
      { description: "above maximum", camera: Camera.create(0, 0, 15), minZoom: 0.1, maxZoom: 10, expectedZoom: 10 },
      { description: "at minimum", camera: Camera.create(0, 0, 0.1), minZoom: 0.1, maxZoom: 10, expectedZoom: 0.1 },
      { description: "at maximum", camera: Camera.create(0, 0, 10), minZoom: 0.1, maxZoom: 10, expectedZoom: 10 },
    ])("should clamp $description", ({ camera, minZoom, maxZoom, expectedZoom }) => {
      const clamped = Camera.clampZoom(camera, minZoom, maxZoom);
      expect(clamped.zoom).toBe(expectedZoom);
      expect(clamped.x).toBe(camera.x);
      expect(clamped.y).toBe(camera.y);
    });

    it("should return same camera if no clamping needed", () => {
      const camera = Camera.create(10, 20, 1);
      const clamped = Camera.clampZoom(camera, 0.1, 10);
      expect(clamped).toBe(camera);
    });

    it("should use default min/max when not specified", () => {
      expect(Camera.clampZoom(Camera.create(0, 0, 0.05)).zoom).toBe(0.1);
      expect(Camera.clampZoom(Camera.create(0, 0, 15)).zoom).toBe(10);
    });
  });

  describe("getViewportBounds", () => {
    it("should return correct bounds for camera at origin", () => {
      const camera = Camera.create(0, 0, 1);
      const bounds = Camera.getViewportBounds(camera, viewport);

      expect(bounds.min.x).toBeCloseTo(-400);
      expect(bounds.min.y).toBeCloseTo(-300);
      expect(bounds.max.x).toBeCloseTo(400);
      expect(bounds.max.y).toBeCloseTo(300);
      expect(bounds.width).toBeCloseTo(800);
      expect(bounds.height).toBeCloseTo(600);
    });

    it("should return correct bounds for offset camera", () => {
      const camera = Camera.create(100, 200, 1);
      const bounds = Camera.getViewportBounds(camera, viewport);

      expect(bounds.min.x).toBeCloseTo(-300);
      expect(bounds.min.y).toBeCloseTo(-100);
      expect(bounds.max.x).toBeCloseTo(500);
      expect(bounds.max.y).toBeCloseTo(500);
    });

    it("should return correct bounds for zoomed camera", () => {
      const camera = Camera.create(0, 0, 2);
      const bounds = Camera.getViewportBounds(camera, viewport);

      expect(bounds.width).toBeCloseTo(400);
      expect(bounds.height).toBeCloseTo(300);
      expect(bounds.min.x).toBeCloseTo(-200);
      expect(bounds.max.x).toBeCloseTo(200);
    });

    it("should return correct bounds for zoomed out camera", () => {
      const camera = Camera.create(0, 0, 0.5);
      const bounds = Camera.getViewportBounds(camera, viewport);
      expect(bounds.width).toBeCloseTo(1600);
      expect(bounds.height).toBeCloseTo(1200);
    });
  });

  describe("edge cases", () => {
    it("should handle very large world coordinates", () => {
      const camera = Camera.create(1_000_000, 2_000_000, 1);
      const worldPoint = { x: 999_999, y: 1_999_999 };
      const screenPoint = Camera.worldToScreen(camera, worldPoint, viewport);
      const backToWorld = Camera.screenToWorld(camera, screenPoint, viewport);

      expect(backToWorld.x).toBeCloseTo(worldPoint.x, 5);
      expect(backToWorld.y).toBeCloseTo(worldPoint.y, 5);
    });

    it("should handle very small zoom levels", () => {
      const camera = Camera.create(0, 0, 0.001);
      const worldPoint = { x: 100_000, y: 50_000 };
      const screenPoint = Camera.worldToScreen(camera, worldPoint, viewport);
      const backToWorld = Camera.screenToWorld(camera, screenPoint, viewport);

      expect(backToWorld.x).toBeCloseTo(worldPoint.x, 0);
      expect(backToWorld.y).toBeCloseTo(worldPoint.y, 0);
    });

    it("should handle very large zoom levels", () => {
      const camera = Camera.create(0, 0, 100);
      const worldPoint = { x: 1, y: 0.5 };
      const screenPoint = Camera.worldToScreen(camera, worldPoint, viewport);
      const backToWorld = Camera.screenToWorld(camera, screenPoint, viewport);

      expect(backToWorld.x).toBeCloseTo(worldPoint.x, 5);
      expect(backToWorld.y).toBeCloseTo(worldPoint.y, 5);
    });

    it("should handle fractional pixel coordinates", () => {
      const camera = Camera.create(0, 0, 1);
      const screenPoint = { x: 123.456, y: 789.012 };
      const worldPoint = Camera.screenToWorld(camera, screenPoint, viewport);
      const backToScreen = Camera.worldToScreen(camera, worldPoint, viewport);

      expect(backToScreen.x).toBeCloseTo(screenPoint.x);
      expect(backToScreen.y).toBeCloseTo(screenPoint.y);
    });

    it("should handle negative zoom gracefully in transforms", () => {
      const camera = Camera.create(0, 0, -1);
      const worldPoint = { x: 100, y: 50 };
      const screenPoint = Camera.worldToScreen(camera, worldPoint, viewport);
      const backToWorld = Camera.screenToWorld(camera, screenPoint, viewport);

      expect(backToWorld.x).toBeCloseTo(worldPoint.x);
      expect(backToWorld.y).toBeCloseTo(worldPoint.y);
    });

    it("should handle different viewport sizes", () => {
      const smallViewport: Viewport = { width: 320, height: 240 };
      const largeViewport: Viewport = { width: 1920, height: 1080 };
      const camera = Camera.create(0, 0, 1);
      const worldPoint = { x: 100, y: 50 };

      const screenSmall = Camera.worldToScreen(camera, worldPoint, smallViewport);
      const backSmall = Camera.screenToWorld(camera, screenSmall, smallViewport);
      expect(backSmall.x).toBeCloseTo(worldPoint.x);
      expect(backSmall.y).toBeCloseTo(worldPoint.y);

      const screenLarge = Camera.worldToScreen(camera, worldPoint, largeViewport);
      const backLarge = Camera.screenToWorld(camera, screenLarge, largeViewport);
      expect(backLarge.x).toBeCloseTo(worldPoint.x);
      expect(backLarge.y).toBeCloseTo(worldPoint.y);
    });

    it("should handle zero-sized viewport dimensions gracefully", () => {
      const zeroViewport: Viewport = { width: 0, height: 0 };
      const camera = Camera.create(0, 0, 1);
      const worldPoint = { x: 100, y: 50 };
      const screenPoint = Camera.worldToScreen(camera, worldPoint, zeroViewport);
      expect(screenPoint).toBeDefined();
    });
  });

  describe("integration scenarios", () => {
    it("should handle pan then zoom correctly", () => {
      let camera = Camera.create(0, 0, 1);
      const anchorScreen = { x: 300, y: 250 };

      camera = Camera.pan(camera, { x: 100, y: 50 });

      const anchorWorld = Camera.screenToWorld(camera, anchorScreen, viewport);

      camera = Camera.zoomAt(camera, 2, anchorScreen, viewport);

      const anchorScreenAfter = Camera.worldToScreen(camera, anchorWorld, viewport);
      expect(anchorScreenAfter.x).toBeCloseTo(anchorScreen.x, 5);
      expect(anchorScreenAfter.y).toBeCloseTo(anchorScreen.y, 5);
    });

    it("should handle zoom then pan correctly", () => {
      let camera = Camera.create(0, 0, 1);
      const testWorldPoint = { x: 100, y: 200 };

      camera = Camera.zoomAt(camera, 2, { x: 400, y: 300 }, viewport);

      const screenBefore = Camera.worldToScreen(camera, testWorldPoint, viewport);

      camera = Camera.pan(camera, { x: 50, y: 30 });

      const screenAfter = Camera.worldToScreen(camera, testWorldPoint, viewport);
      expect(screenAfter.x - screenBefore.x).toBeCloseTo(50, 5);
      expect(screenAfter.y - screenBefore.y).toBeCloseTo(30, 5);
    });

    it("should handle complex manipulation sequence", () => {
      let camera = Camera.create(0, 0, 1);
      const trackPoint = { x: 500, y: 300 };

      camera = Camera.pan(camera, { x: 50, y: 25 });
      camera = Camera.zoomAt(camera, 1.5, { x: 400, y: 300 }, viewport);
      camera = Camera.pan(camera, { x: -30, y: 40 });
      camera = Camera.zoomAt(camera, 0.8, { x: 600, y: 200 }, viewport);

      const screenPoint = Camera.worldToScreen(camera, trackPoint, viewport);
      const backToWorld = Camera.screenToWorld(camera, screenPoint, viewport);

      expect(backToWorld.x).toBeCloseTo(trackPoint.x, 5);
      expect(backToWorld.y).toBeCloseTo(trackPoint.y, 5);
    });

    it("should maintain consistency after many zoom operations", () => {
      let camera = Camera.create(0, 0, 1);
      const anchorScreen = { x: 400, y: 300 };
      const anchorWorld = Camera.screenToWorld(camera, anchorScreen, viewport);

      for (let i = 0; i < 10; i++) {
        camera = Camera.zoomAt(camera, 1.1, anchorScreen, viewport);
      }

      for (let i = 0; i < 10; i++) {
        camera = Camera.zoomAt(camera, 1 / 1.1, anchorScreen, viewport);
      }

      expect(camera.zoom).toBeCloseTo(1, 5);

      const anchorScreenAfter = Camera.worldToScreen(camera, anchorWorld, viewport);
      expect(anchorScreenAfter.x).toBeCloseTo(anchorScreen.x, 3);
      expect(anchorScreenAfter.y).toBeCloseTo(anchorScreen.y, 3);
    });
  });
});
