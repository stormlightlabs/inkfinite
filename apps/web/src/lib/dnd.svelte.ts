import { stencils } from "inkfinite-core";

type Stencil = stencils.Stencil;

let currentStencil = $state<Stencil | null>(null);

export const draggingStencil = {
  get current() {
    return currentStencil;
  },
};

export function startDrag(stencil: Stencil) {
  currentStencil = stencil;
}

export function endDrag() {
  currentStencil = null;
}
