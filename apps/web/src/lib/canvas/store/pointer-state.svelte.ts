export class PointerState {
  isPointerDown = $state(false);
  snappedWorld = $state<{ x: number; y: number } | null>(null);
}
