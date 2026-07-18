export class HandleState {
  hover = $state<string | null>(null);
  active = $state<string | null>(null);

  getSnapshot() {
    return { hover: this.hover, active: this.active };
  }
}
