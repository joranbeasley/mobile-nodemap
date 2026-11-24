import type { Graph } from './graph.js';
import type { GraphJSON } from './types.js';

/** Snapshot-based undo/redo. Bursts of changes (a slider drag) collapse into one step. */
export class History {
  private stack: string[] = [];
  private index = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private applying = false;
  private off: () => void;

  constructor(
    private graph: Graph,
    private settleMs = 300,
    private limit = 100,
  ) {
    this.push(graph.toJSON());
    this.off = graph.on('change', () => {
      if (this.applying) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.commit(), this.settleMs);
    });
  }

  /** Record the current state now (call before an undo if a change may still be settling). */
  commit(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const snap = JSON.stringify(this.graph.toJSON());
    if (snap === this.stack[this.index]) return;
    this.stack.splice(this.index + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  get canUndo(): boolean {
    return this.index > 0 || this.timer !== undefined;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  undo(): void {
    if (this.timer !== undefined) this.commit();
    if (this.index <= 0) return;
    this.apply(this.stack[--this.index]);
  }

  redo(): void {
    if (!this.canRedo) return;
    this.apply(this.stack[++this.index]);
  }

  reset(): void {
    this.stack = [];
    this.index = -1;
    this.push(this.graph.toJSON());
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.off();
  }

  private push(json: GraphJSON) {
    this.stack.push(JSON.stringify(json));
    this.index = this.stack.length - 1;
  }

  private apply(snap: string) {
    this.applying = true;
    try {
      this.graph.load(JSON.parse(snap));
    } finally {
      this.applying = false;
    }
  }
}
