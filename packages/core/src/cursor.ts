import { BehaviorSubject, type Subscription } from "rxjs";
import { Vec2 } from "./math";

/**
 * Cursor position + timing in world/screen space.
 *
 * CursorState is intentionally separate from EditorState so it can be updated
 * with high frequency (e.g., on pointer move) without touching history or
 * triggering document persistence.
 */
export type CursorState = { cursorWorld: Vec2; cursorScreen?: Vec2; lastMoveAt: number };

export const CursorState = {
  /**
   * Create a cursor state positioned at origin with no screen point.
   */
  create(world?: Vec2, screen?: Vec2, timestamp = Date.now()): CursorState {
    return {
      cursorWorld: Vec2.clone(world ?? { x: 0, y: 0 }),
      cursorScreen: screen ? Vec2.clone(screen) : undefined,
      lastMoveAt: timestamp,
    };
  },
};

export type CursorListener = (state: CursorState) => void;

/**
 * Store that tracks cursor movement separately from the undoable editor state.
 */
export class CursorStore {
  private readonly state$: BehaviorSubject<CursorState>;

  constructor(initialState?: CursorState) {
    this.state$ = new BehaviorSubject(initialState ?? CursorState.create());
  }

  /**
   * Read the latest cursor snapshot.
   */
  getState(): CursorState {
    return this.state$.value;
  }

  /**
   * Subscribe to cursor updates.
   */
  subscribe(listener: CursorListener): () => void {
    const subscription: Subscription = this.state$.subscribe(listener);
    return () => subscription.unsubscribe();
  }

  /**
   * Update the cursor position without touching editor history/persistence.
   */
  updateCursor(world: Vec2, screen?: Vec2, timestamp = Date.now()): void {
    this.state$.next({
      cursorWorld: Vec2.clone(world),
      cursorScreen: screen ? Vec2.clone(screen) : undefined,
      lastMoveAt: timestamp,
    });
  }
}
