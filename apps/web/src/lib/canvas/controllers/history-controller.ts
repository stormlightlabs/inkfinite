import type { CanvasControllerBindings } from "../canvas-store.svelte";

export class HistoryController {
  constructor(
    private bindings: CanvasControllerBindings,
  ) {}

  handleClick = () => {
    this.bindings.setHistoryViewerOpen(true);
  };

  handleClose = () => {
    this.bindings.setHistoryViewerOpen(false);
  };
}
