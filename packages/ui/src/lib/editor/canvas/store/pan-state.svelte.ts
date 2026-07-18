export class PanState {
  isPanning = $state(false);
  spaceHeld = $state(false);
  lastScreen = $state({ x: 0, y: 0 });
}
