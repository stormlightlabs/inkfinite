import type { Stencil } from "./types";

class StencilRegistry {
  private stencils = new Map<string, Stencil>();

  register(stencil: Stencil) {
    if (this.stencils.has(stencil.id)) {
      console.warn(`Stencil with id ${stencil.id} already registered. Overwriting.`);
    }
    this.stencils.set(stencil.id, stencil);
  }

  get(id: string): Stencil | undefined {
    return this.stencils.get(id);
  }

  getAll(): Stencil[] {
    return Array.from(this.stencils.values());
  }

  search(query: string): Stencil[] {
    const q = query.toLowerCase();
    return this.getAll().filter((s) =>
      s.name.toLowerCase().includes(q)
      || s.category.toLowerCase().includes(q)
      || s.tags.some((t) => t.toLowerCase().includes(q))
    );
  }
}

export const registry = new StencilRegistry();
