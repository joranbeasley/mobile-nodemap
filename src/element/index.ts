import { Graph } from '../core/graph.js';
import { Registry } from '../core/registry.js';
import type { GraphJSON } from '../core/types.js';
import { Evaluator, type EvalReport } from '../runtime/evaluator.js';
import { compile } from '../runtime/compile.js';
import { getGraphType, type GraphType } from '../core/graph-type.js';
import { mathGraph } from '../graph-types/index.js';
import { NodeEditor } from '../editor/editor.js';
import type { LayoutEngine } from '../layout/types.js';

// Keep this module importable outside browsers (SSR, Node tests of other entry points).
const Base: typeof HTMLElement = typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as typeof HTMLElement);

const hostCss = `
:host { display: block; position: relative; height: 360px; contain: content; border-radius: inherit; overflow: hidden; }
:host([hidden]) { display: none; }
.canvas.nm-root { position: absolute; inset: 0; border-radius: inherit; }
`;

/**
 * `<node-map>`: the editor and evaluator as a custom element.
 *
 *   <node-map wires="smart" auto-layout>
 *     <script type="application/json">{ "version": 1, "nodes": [...], "edges": [...] }</script>
 *   </node-map>
 *
 * Attributes: `graph-type` (a registered graph type id), `direction` (auto | LR | TB), `wires` (smart | curved), `theme` (light | dark, or a theme id such as midnight, paper, synthwave), `no-toolbar`, `no-eval`, `auto-layout`.
 * Properties: `graphType`, `registry` (defaults to the graph type's), `value` (graph JSON), `graph`, `editor`, `evaluator`, `layout`.
 * Methods: `autoLayout()`, `fit()`, `run(inputs)`, `call(inputs)`.
 * Events: `change` ({ value, change }), `select` ({ node, edge }), `evaluate` (EvalReport).
 * Style it with CSS custom properties (--nm-bg, --nm-accent, …); they pass into the shadow root.
 */
export class NodeMapElement extends Base {
  static observedAttributes = ['wires', 'theme', 'graph-type', 'direction'];

  private _registry?: Registry;
  private _layout?: LayoutEngine;
  private _graph?: Graph;
  private _evaluator?: Evaluator;
  private _editor?: NodeEditor;
  private _pending?: GraphJSON;
  private _canvas?: HTMLDivElement;
  private _offs: (() => void)[] = [];

  /**
   * The node types, rules and engine in use. Defaults to the graph type named by the
   * `graph-type` attribute (or the inline JSON's `type`), else the built-in math graph.
   */
  get registry(): Registry {
    return (this._registry ??= this.resolveGraphType().createRegistry());
  }
  set registry(r: Registry) {
    this._registry = r;
    if (this._editor) this.mount();
  }

  /** Use a graph type object directly (no registration needed). */
  set graphType(type: GraphType) {
    this._graphType = type;
    this._registry = undefined;
    if (this._editor) this.mount();
  }

  private _graphType?: GraphType;

  private resolveGraphType(): GraphType {
    if (this._graphType) return this._graphType;
    const id = this.getAttribute('graph-type') ?? this.inlineJson()?.type;
    const t = id ? getGraphType(id) : undefined;
    if (id && !t) console.warn(`<node-map>: unknown graph type "${id}"; register it with registerGraphType()`);
    return t ?? mathGraph;
  }

  get layout(): LayoutEngine | undefined {
    return this._layout;
  }
  set layout(engine: LayoutEngine | undefined) {
    this._layout = engine;
    if (engine) this._editor?.setLayout(engine);
  }

  get value(): GraphJSON {
    return this._graph?.toJSON() ?? this._pending ?? this.inlineJson() ?? { version: 1, nodes: [], edges: [] };
  }
  set value(json: GraphJSON) {
    if (this._graph) {
      this._graph.load(json);
      this._editor?.history?.reset();
      requestAnimationFrame(() => this._editor?.fit());
    } else this._pending = json;
  }

  get graph(): Graph | undefined {
    return this._graph;
  }
  get editor(): NodeEditor | undefined {
    return this._editor;
  }
  get evaluator(): Evaluator | undefined {
    return this._evaluator;
  }

  connectedCallback(): void {
    // Properties set before the element was defined live on the instance; re-apply them through the setters.
    for (const prop of ['graphType', 'registry', 'layout', 'value'] as const) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const v = (this as any)[prop];
        delete (this as any)[prop];
        (this as any)[prop] = v;
      }
    }
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = hostCss;
      this._canvas = document.createElement('div');
      this._canvas.className = 'canvas';
      this._canvas.setAttribute('part', 'canvas');
      root.append(style, this._canvas);
    }
    if (!this._editor) this.mount();
  }

  disconnectedCallback(): void {
    // Defer, so moving the element within the page does not tear it down.
    queueMicrotask(() => {
      if (!this.isConnected) this.unmount();
    });
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'graph-type' && this._editor && !this._graphType) {
      this._registry = undefined;
      this.mount();
    }
    if (name === 'direction' && this._editor) this._editor.setDirection(dirAttr(value));
    if (name === 'wires' && this._editor) this._editor.setWires(value === 'curved' ? 'curved' : 'smart');
    if (name === 'theme' && this._canvas) this.applyTheme(value);
  }

  async autoLayout(opts?: Parameters<NodeEditor['autoLayout']>[0]): Promise<void> {
    await this._editor?.autoLayout(opts);
  }

  fit(): void {
    this._editor?.fit({ minScale: 0 });
  }

  /** Evaluate the map in place (results show on the nodes). */
  run(inputs?: Record<string, unknown>): Promise<EvalReport> | undefined {
    return this._evaluator?.run({ inputs });
  }

  /** Call the map as a function without touching the editor. */
  call(inputs: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return compile(this.value, this.registry)(inputs);
  }

  private inlineJson(): GraphJSON | undefined {
    const script = this.querySelector('script[type="application/json"]');
    if (!script?.textContent?.trim()) return;
    try {
      return JSON.parse(script.textContent);
    } catch (err) {
      console.warn('<node-map>: could not parse inline JSON', err);
      return;
    }
  }

  private mount(): void {
    const json = this._graph?.toJSON() ?? this._pending ?? this.inlineJson();
    this.unmount();
    if (!this._canvas) return;
    const registry = this.registry;
    const graph = (this._graph = new Graph(registry));
    if (json) graph.load(json);
    this._evaluator = this.hasAttribute('no-eval') ? undefined : new Evaluator(graph, registry);

    const editor = (this._editor = new NodeEditor(this._canvas, {
      graph,
      registry,
      evaluator: this._evaluator,
      toolbar: !this.hasAttribute('no-toolbar'),
      wires: this.getAttribute('wires') === 'curved' ? 'curved' : 'smart',
      direction: dirAttr(this.getAttribute('direction')),
      layout: this._layout,
    }));
    this.applyTheme(this.getAttribute('theme'));
    const fire = (type: string, detail: unknown) => this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    this._offs.push(graph.on('change', (change) => fire('change', { change, value: graph.toJSON() })));
    this._offs.push(editor.on('select', (sel) => fire('select', sel)));
    if (this._evaluator) this._offs.push(this._evaluator.on('done', (report) => fire('evaluate', report)));
    if (this.hasAttribute('auto-layout') || (!this._registry?.id ? false : getGraphType(this._registry.id)?.editor?.autoLayout)) requestAnimationFrame(() => void editor.autoLayout({ animate: false }));
  }

  /** 'light' / 'dark' follow the default palette; any other value is a registered theme id. */
  private applyTheme(value: string | null): void {
    if (!this._canvas) return;
    if (!value || value === 'light' || value === 'dark') {
      this._editor?.setTheme(null);
      if (value) this._canvas.dataset.theme = value;
      else delete this._canvas.dataset.theme;
    } else this._editor?.setTheme(value);
  }

  private unmount(): void {
    this._offs.forEach((off) => off());
    this._offs = [];
    this._editor?.destroy();
    this._editor = undefined;
  }
}

function dirAttr(v: string | null): 'auto' | 'LR' | 'TB' {
  const u = (v ?? '').toUpperCase();
  return u === 'LR' || u === 'TB' ? u : 'auto';
}

/** Register the element (default tag `node-map`). Safe to call more than once. */
export function defineNodeMapElement(tag = 'node-map'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) customElements.define(tag, NodeMapElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'node-map': NodeMapElement;
  }
}
