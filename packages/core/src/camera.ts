import { Vec2 } from "./math";

/**
 * Camera represents the viewport into the infinite canvas
 * - x, y: world coordinates at the center of the screen
 * - zoom: scale factor (1 = 100%, 2 = 200% zoomed in, 0.5 = 50% zoomed out)
 */
export type Camera = { x: number; y: number; zoom: number };

/**
 * Viewport dimensions in screen pixels
 */
export type Viewport = { width: number; height: number };

export const Camera = {
  /**
   * Create a new camera with default values
   */
  create(x = 0, y = 0, zoom = 1): Camera {
    return { x, y, zoom };
  },

  /**
   * Transform a point from world coordinates to screen coordinates
   *
   * Algorithm:
   * 1. Translate point relative to camera position
   * 2. Scale by zoom factor
   * 3. Translate to screen center
   *
   * @param camera - The camera
   * @param worldPoint - Point in world coordinates
   * @param viewport - Screen viewport dimensions
   * @returns Point in screen coordinates (pixels)
   */
  worldToScreen(camera: Camera, worldPoint: Vec2, viewport: Viewport): Vec2 {
    const offsetX = worldPoint.x - camera.x;
    const offsetY = worldPoint.y - camera.y;
    return { x: offsetX * camera.zoom + viewport.width / 2, y: offsetY * camera.zoom + viewport.height / 2 };
  },

  /**
   * Transform a point from screen coordinates to world coordinates
   *
   * This is the inverse of worldToScreen
   *
   * @param camera - The camera
   * @param screenPoint - Point in screen coordinates (pixels)
   * @param viewport - Screen viewport dimensions
   * @returns Point in world coordinates
   */
  screenToWorld(camera: Camera, screenPoint: Vec2, viewport: Viewport): Vec2 {
    const offsetX = screenPoint.x - viewport.width / 2;
    const offsetY = screenPoint.y - viewport.height / 2;
    return { x: offsetX / camera.zoom + camera.x, y: offsetY / camera.zoom + camera.y };
  },

  /**
   * Pan the camera by a delta in screen space
   *
   * When the user drags the canvas, they move it in screen pixels.
   * We need to convert that to world space movement.
   *
   * @param camera - The current camera
   * @param deltaScreen - Movement delta in screen pixels
   * @returns New camera with updated position
   */
  pan(camera: Camera, deltaScreen: Vec2): Camera {
    const worldDeltaX = -deltaScreen.x / camera.zoom;
    const worldDeltaY = -deltaScreen.y / camera.zoom;
    return { x: camera.x + worldDeltaX, y: camera.y + worldDeltaY, zoom: camera.zoom };
  },

  /**
   * Zoom the camera at a specific screen anchor point
   *
   * The anchor point should remain at the same screen position after zoom.
   * This creates the "zoom to cursor" behavior.
   *
   * Algorithm:
   * 1. Convert anchor from screen to world coordinates (at current zoom)
   * 2. Apply zoom factor
   * 3. Convert anchor back to screen coordinates (at new zoom)
   * 4. Adjust camera position so anchor stays at same screen position
   *
   * @param camera - The current camera
   * @param factor - Zoom multiplier (e.g., 1.1 = zoom in 10%, 0.9 = zoom out 10%)
   * @param anchorScreen - The screen point to zoom towards
   * @param viewport - Screen viewport dimensions
   * @returns New camera with updated zoom and position
   */
  zoomAt(camera: Camera, factor: number, anchorScreen: Vec2, viewport: Viewport): Camera {
    const anchorWorld = Camera.screenToWorld(camera, anchorScreen, viewport);
    const newZoom = camera.zoom * factor;

    const offsetX = anchorScreen.x - viewport.width / 2;
    const offsetY = anchorScreen.y - viewport.height / 2;

    return { x: anchorWorld.x - offsetX / newZoom, y: anchorWorld.y - offsetY / newZoom, zoom: newZoom };
  },

  /**
   * Clamp camera zoom to reasonable bounds
   *
   * @param camera - The camera to clamp
   * @param minZoom - Minimum zoom level (default: 0.1 = 10%)
   * @param maxZoom - Maximum zoom level (default: 10 = 1000%)
   * @returns Camera with clamped zoom
   */
  clampZoom(camera: Camera, minZoom = 0.1, maxZoom = 10): Camera {
    const clampedZoom = Math.max(minZoom, Math.min(maxZoom, camera.zoom));

    if (clampedZoom === camera.zoom) {
      return camera;
    }

    return { x: camera.x, y: camera.y, zoom: clampedZoom };
  },

  /**
   * Reset camera to default position and zoom
   *
   * @returns Camera at origin with 100% zoom
   */
  reset(): Camera {
    return Camera.create(0, 0, 1);
  },

  /**
   * Clone a camera
   *
   * @param camera - Camera to clone
   * @returns New camera with same values
   */
  clone(camera: Camera): Camera {
    return { x: camera.x, y: camera.y, zoom: camera.zoom };
  },

  /**
   * Check if two cameras are approximately equal
   *
   * @param a - First camera
   * @param b - Second camera
   * @param epsilon - Tolerance for comparison
   * @returns True if cameras are equal within epsilon
   */
  equals(a: Camera, b: Camera, epsilon = 1e-10): boolean {
    return (Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon && Math.abs(a.zoom - b.zoom) <= epsilon);
  },

  /**
   * Get the world-space bounds visible in the viewport
   *
   * @param camera - The camera
   * @param viewport - Screen viewport dimensions
   * @returns Bounding box in world coordinates
   */
  getViewportBounds(camera: Camera, viewport: Viewport) {
    const topLeft = Camera.screenToWorld(camera, { x: 0, y: 0 }, viewport);
    const bottomRight = Camera.screenToWorld(camera, { x: viewport.width, y: viewport.height }, viewport);

    return { min: topLeft, max: bottomRight, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
  },
};
