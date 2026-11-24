import { Emitter } from '../core/emitter.js';
import { Graph, ConnectionError } from '../core/graph.js';
import { History } from '../core/history.js';
import { Registry } from '../core/registry.js';
import type { Edge, NodeInstance, NodeResult, NodeType, ParamDef, PortDef, PortRef } from '../core/types.js';
import type { Evaluator } from '../runtime/evaluator.js';
import { formatValue } from '../runtime/stdlib.js';
import { injectStyles } from './styles.js';

type Dir = 'in' | 'out';
interface Anchor extends PortRef {
  dir: Dir;
}
interface Viewport {
  x: number;
  y: number;
  k: number;
}

export interface EditorOptions {
  graph: Graph;
  registry: Registry;
  /** When given, node results are shown live and the evaluator re-runs on every edit. */
  evaluator?: Evaluator;
  /** Show the floating toolbar (add, undo, redo, fit, delete). Default true. */
  toolbar?: boolean;
  /** Track undo/redo. Default true. */
  history?: boolean;
  minZoom?: number;
  maxZoom?: number;
  /** Long-press duration that opens the add-node sheet, in ms. Default 450. */
  longPressMs?: number;
}

export interface EditorEvents extends Record<string, unknown> {
  select: { node?: string; edge?: string };
  viewport: Viewport;
  error: string;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; timer?: ReturnType<typeof setTimeout> }
  | { kind: 'pinch'; dist: number; mx: number; my: number; vp: Viewport }
  | { kind: 'node'; id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean }
  | { kind: 'wire'; anchor: Anchor; sx: number; sy: number; moved: boolean; detached?: Edge }
  | { kind: 'edge'; id: string; sx: number; sy: number; moved: boolean; vx: number; vy: number };

interface NodeRecord {
  el: HTMLElement;
  portsKey: string;
  offsets: Map<string, { x: number; y: number }>;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const TAP = 8;

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
};

const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
};

/**
 * A touch-first node map editor.
 *
 * Gestures: drag the background to pan, pinch or wheel to zoom, drag a node to move it,
 * drag from a port to wire it (or tap one port, then another), tap a wire to select it,
 * long-press the background (or press +) to add a node. Drop a wire on empty space to
 * add a node that is connected to it.
 */
export class NodeEditor extends Emitter<EditorEvents> {
  readonly root: HTMLElement;
  readonly history?: History;
  readonly graph: Graph;
  readonly registry: Registry;
  readonly evaluator?: Evaluator;

  private viewportEl: HTMLElement;
  private wires: SVGSVGElement;
  private tempWire: SVGPathElement;
  private hud: HTMLElement;
  private toast: HTMLElement;
  private toolbar?: HTMLElement;
  private sheet?: HTMLElement;
  private records = new Map<string, NodeRecord>();
  private edgeEls = new Map<string, SVGGElement>();
  private vp: Viewport = { x: 0, y: 0, k: 1 };
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private pending: Anchor | null = null;
  private selected: { node?: string; edge?: string } = {};
  private resizeObs?: ResizeObserver;
  private disposers: (() => void)[] = [];
  private toastTimer?: ReturnType<typeof setTimeout>;
  /** Ignore sheet taps until this time: the finger that opened the sheet would otherwise "click" an item as it lifts. */
  private sheetGuard = 0;
  private opts: Required<Pick<EditorOptions, 'minZoom' | 'maxZoom' | 'longPressMs'>>;

  constructor(container: HTMLElement, options: EditorOptions) {
    super();
    injectStyles(container.ownerDocument);
    this.graph = options.graph;
    this.registry = options.registry;
    this.evaluator = options.evaluator;
    this.opts = { minZoom: 0.2, maxZoom: 2.5, longPressMs: 450, ...options };
    if (options.history !== false) this.history = new History(this.graph);

    this.root = container;
    container.classList.add('nm-root');
    container.tabIndex = container.tabIndex >= 0 ? container.tabIndex : 0;
    this.viewportEl = h('div', { class: 'nm-viewport' });
    this.wires = document.createElementNS(SVGNS, 'svg');
    this.wires.classList.add('nm-wires');
    this.tempWire = document.createElementNS(SVGNS, 'path');
    this.tempWire.classList.add('nm-temp');
    this.wires.append(this.tempWire);
    this.viewportEl.append(this.wires);
    this.hud = h('div', { class: 'nm-hud', hidden: '' });
    this.toast = h('div', { class: 'nm-toast', hidden: '', role: 'status' });
    container.append(this.viewportEl, this.hud, this.toast);
    if (options.toolbar !== false) this.buildToolbar();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver((entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.id;
          if (id && this.records.has(id)) {
            this.measure(id);
            this.drawEdgesOf(id);
          }
        }
      });
    }

    this.bindInput();
    this.disposers.push(this.graph.on('change', (c) => this.onGraphChange(c)));
    if (this.evaluator) {
      const ev = this.evaluator;
      this.disposers.push(ev.on('node', ({ id, result }) => this.showResult(id, result)));
      this.disposers.push(ev.live());
    }
    this.renderAll();
    requestAnimationFrame(() => this.fit());
  }

  // ---------------------------------------------------------------- public API

  /** Convert a client (screen) coordinate to world coordinates. */
  screenToWorld(cx: number, cy: number): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: (cx - r.left - this.vp.x) / this.vp.k, y: (cy - r.top - this.vp.y) / this.vp.k };
  }

  get viewport(): Viewport {
    return { ...this.vp };
  }

  setViewport(vp: Partial<Viewport>): void {
    this.vp = { ...this.vp, ...vp };
    this.vp.k = Math.min(this.opts.maxZoom, Math.max(this.opts.minZoom, this.vp.k));
    this.viewportEl.style.transform = `translate(${this.vp.x}px, ${this.vp.y}px) scale(${this.vp.k})`;
    const s = 22 * this.vp.k;
    this.root.style.backgroundSize = `${s}px ${s}px`;
    this.root.style.backgroundPosition = `${this.vp.x}px ${this.vp.y}px`;
    this.emit('viewport', this.viewport);
  }

  zoomAt(factor: number, cx?: number, cy?: number): void {
    const r = this.root.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    const k = Math.min(this.opts.maxZoom, Math.max(this.opts.minZoom, this.vp.k * factor));
    const f = k / this.vp.k;
    this.setViewport({ k, x: px - (px - this.vp.x) * f, y: py - (py - this.vp.y) * f });
  }

  /**
   * Zoom and pan so every node is visible. On small screens the zoom never drops below
   * `minScale` (default 0.6) so text stays readable; the map then starts at its top-left.
   */
  fit(opts: { padding?: number; minScale?: number } = {}): void {
    const padding = opts.padding ?? 32;
    const minScale = Math.max(this.opts.minZoom, opts.minScale ?? 0.6);
    const r = this.root.getBoundingClientRect();
    if (!this.graph.nodes.size || !r.width) return this.setViewport({ x: r.width / 2, y: r.height / 2, k: 1 });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.graph.nodes.values()) {
      const el = this.records.get(n.id)?.el;
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + (el?.offsetWidth || 180));
      y1 = Math.max(y1, n.y + (el?.offsetHeight || 100));
    }
    const bottomUi = this.toolbar ? 64 : 0;
    const w = r.width - padding * 2;
    const hgt = r.height - padding * 2 - bottomUi;
    const ideal = Math.min(w / (x1 - x0), hgt / (y1 - y0), 1.15);
    const k = Math.min(this.opts.maxZoom, Math.max(minScale, ideal));
    const cx = (x1 - x0) * k <= w ? (w - (x1 - x0) * k) / 2 : 0;
    const cy = (y1 - y0) * k <= hgt ? (hgt - (y1 - y0) * k) / 2 : 0;
    this.setViewport({ k, x: padding + cx - x0 * k, y: padding + cy - y0 * k });
  }

  select(sel: { node?: string; edge?: string }): void {
    if (this.selected.node) this.records.get(this.selected.node)?.el.classList.remove('nm-selected');
    if (this.selected.edge) this.edgeEls.get(this.selected.edge)?.classList.remove('nm-selected');
    this.selected = sel;
    if (sel.node) this.records.get(sel.node)?.el.classList.add('nm-selected');
    if (sel.edge) this.edgeEls.get(sel.edge)?.classList.add('nm-selected');
    this.updateToolbar();
    this.emit('select', { ...sel });
  }

  get selection(): { node?: string; edge?: string } {
    return { ...this.selected };
  }

  deleteSelection(): void {
    if (this.selected.node) this.graph.removeNode(this.selected.node);
    else if (this.selected.edge) this.graph.disconnect(this.selected.edge);
    this.select({});
  }

  duplicateSelection(): void {
    const n = this.selected.node && this.graph.nodes.get(this.selected.node);
    if (!n) return;
    const copy = this.graph.addNode(n.type, { x: n.x + 30, y: n.y + 30, params: structuredClone(n.params) });
    this.select({ node: copy.id });
  }

  /** Add a node of `type` centred on the given world position (defaults to the middle of the view). */
  addNode(type: string, at?: { x: number; y: number }): NodeInstance {
    const r = this.root.getBoundingClientRect();
    const p = at ?? this.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    const node = this.graph.addNode(type, { x: Math.round(p.x - 90), y: Math.round(p.y - 30) });
    this.select({ node: node.id });
    return node;
  }

  /** Open the add-node sheet. With `connectFrom`, the new node is wired to that port. */
  openPalette(at?: { x: number; y: number }, connectFrom?: Anchor): void {
    this.closePalette();
    this.sheetGuard = this.pointers.size ? Infinity : performance.now() + 350;
    const backdrop = h('div', { class: 'nm-sheet-backdrop' });
    const search = h('input', { type: 'search', placeholder: 'Search nodes', 'aria-label': 'Search nodes', id: 'nm-search' });
    const list = h('div', { class: 'nm-sheet-list', role: 'listbox' });
    const title = connectFrom ? 'Add a connected node' : 'Add a node';
    const sheet = h(
      'div',
      { class: 'nm-sheet', role: 'dialog', 'aria-label': title },
      h('div', { class: 'nm-sheet-grip' }),
      h('div', { class: 'nm-sheet-head' }, h('strong', {}, title), search),
      list,
    );
    const compatible = (t: NodeType) => {
      if (!connectFrom) return true;
      const src = this.portDef(connectFrom);
      const probe = { type: t.type, params: defaults(t) };
      const ports = connectFrom.dir === 'out' ? this.registry.inputsOf(probe) : this.registry.outputsOf(probe);
      return ports.some((p) =>
        connectFrom.dir === 'out' ? this.registry.isCompatible(src?.type, p.type) : this.registry.isCompatible(p.type, src?.type),
      );
    };
    const render = () => {
      const q = search.value.trim().toLowerCase();
      list.textContent = '';
      for (const [cat, types] of this.registry.categories()) {
        const items = types.filter(
          (t) => compatible(t) && (!q || `${t.title} ${t.type} ${cat} ${t.description ?? ''}`.toLowerCase().includes(q)),
        );
        if (!items.length) continue;
        list.append(h('div', { class: 'nm-sheet-cat' }, cat));
        for (const t of items) {
          const btn = h(
            'button',
            { class: 'nm-sheet-item', type: 'button', style: `--c:${t.color ?? 'var(--nm-muted)'}` },
            h('i'),
            t.title ?? t.type,
            h('small', {}, t.description ?? ''),
          );
          btn.addEventListener('click', () => {
            if (performance.now() < this.sheetGuard) return;
            this.closePalette();
            const node = this.addNode(t.type, at);
            if (connectFrom) this.autoConnect(connectFrom, node.id);
          });
          list.append(btn);
        }
      }
      if (!list.childElementCount) list.append(h('div', { class: 'nm-sheet-cat' }, 'No matching nodes'));
    };
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (list.querySelector('.nm-sheet-item') as HTMLButtonElement | null)?.click();
      if (e.key === 'Escape') this.closePalette();
    });
    backdrop.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (performance.now() < this.sheetGuard) return;
      this.closePalette();
    });
    sheet.addEventListener('pointerdown', (e) => e.stopPropagation());
    render();
    this.root.append(backdrop, sheet);
    this.sheet = sheet;
    (sheet as any)._backdrop = backdrop;
    // Only auto-focus search on devices with a keyboard; on phones it would pop the keyboard over the list.
    if (matchMedia?.('(pointer: fine)').matches) search.focus();
  }

  closePalette(): void {
    if (!this.sheet) return;
    (this.sheet as any)._backdrop?.remove();
    this.sheet.remove();
    this.sheet = undefined;
    this.root.focus({ preventScroll: true });
  }

  /** Show a short message over the canvas (used for invalid connections). */
  notify(message: string): void {
    this.toast.textContent = message;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast.hidden = true), 2200);
    this.emit('error', message);
  }

  destroy(): void {
    this.disposers.forEach((d) => d());
    this.history?.dispose();
    this.resizeObs?.disconnect();
    this.root.textContent = '';
    this.root.classList.remove('nm-root');
  }

  // ---------------------------------------------------------------- rendering

  private renderAll(): void {
    this.records.forEach((r) => {
      this.resizeObs?.unobserve(r.el);
      r.el.remove();
    });
    this.records.clear();
    this.edgeEls.forEach((g) => g.remove());
    this.edgeEls.clear();
    for (const n of this.graph.nodes.values()) this.buildNode(n);
    for (const n of this.graph.nodes.values()) this.measure(n.id);
    for (const e of this.graph.edges.values()) this.buildEdge(e);
    this.refreshLinks();
    if (this.selected.node && !this.graph.nodes.has(this.selected.node)) this.select({});
    if (this.selected.edge && !this.graph.edges.has(this.selected.edge)) this.select({});
    for (const [id, r] of this.evaluator?.results ?? []) this.showResult(id, r);
  }

  private onGraphChange(c: import('../core/graph.js').GraphChange): void {
    switch (c.kind) {
      case 'load':
        this.renderAll();
        break;
      case 'node:add':
        this.buildNode(c.node);
        this.measure(c.node.id);
        break;
      case 'node:remove': {
        const r = this.records.get(c.node.id);
        if (r) {
          this.resizeObs?.unobserve(r.el);
          r.el.remove();
        }
        this.records.delete(c.node.id);
        if (this.selected.node === c.node.id) this.select({});
        break;
      }
      case 'node:move':
        this.place(c.node);
        this.drawEdgesOf(c.node.id);
        break;
      case 'node:params': {
        const rec = this.records.get(c.node.id);
        if (rec && rec.portsKey !== this.portsKey(c.node)) {
          this.buildNode(c.node);
          this.measure(c.node.id);
          this.drawEdgesOf(c.node.id);
          this.refreshLinks();
        } else this.syncControls(c.node);
        break;
      }
      case 'edge:add':
        this.buildEdge(c.edge);
        this.refreshLinks();
        break;
      case 'edge:remove':
        this.edgeEls.get(c.edge.id)?.remove();
        this.edgeEls.delete(c.edge.id);
        if (this.selected.edge === c.edge.id) this.select({});
        this.refreshLinks();
        break;
    }
    this.updateToolbar();
  }

  private portsKey(node: NodeInstance): string {
    const f = (ps: PortDef[]) => ps.map((p) => `${p.name}:${p.type}`).join(',');
    return f(this.registry.inputsOf(node)) + '|' + f(this.registry.outputsOf(node));
  }

  private place(node: NodeInstance): void {
    const r = this.records.get(node.id);
    if (r) r.el.style.transform = `translate(${node.x}px, ${node.y}px)`;
  }

  private buildNode(node: NodeInstance): void {
    const def = this.registry.get(node.type);
    const old = this.records.get(node.id);
    const active = old?.el.contains(document.activeElement) ? (document.activeElement as HTMLInputElement) : null;
    const focusKey = active?.dataset.key;
    const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

    const el = h('div', { class: 'nm-node', 'data-id': node.id, role: 'group', 'aria-label': def?.title ?? node.type });
    if (def?.color) el.style.setProperty('--nm-node-accent', def.color);
    el.append(
      h(
        'div',
        { class: 'nm-head' },
        h('span', { class: 'nm-status' }),
        h('span', { class: 'nm-title' }, node.label ?? def?.title ?? node.type),
        h('span', { class: 'nm-cat' }, def?.category ?? ''),
      ),
    );
    const body = h('div', { class: 'nm-body' });
    if (!def) body.append(h('div', { class: 'nm-error' }, `Unknown node type "${node.type}"`));
    for (const p of def?.params ?? []) {
      body.append(h('label', { class: 'nm-field' }, h('span', {}, p.label ?? p.name), this.paramControl(node, p)));
    }
    for (const p of this.registry.outputsOf(node)) {
      body.append(
        h(
          'div',
          { class: 'nm-row nm-out', 'data-port': p.name },
          h('span', { class: 'nm-val' }),
          h('span', { class: 'nm-label' }, p.label ?? p.name),
          h('span', { class: 'nm-port', 'data-dir': 'out', 'data-node': node.id, 'data-port': p.name, 'data-type': p.type ?? 'any', title: `${p.name}: ${p.type ?? 'any'}` }),
        ),
      );
    }
    for (const p of this.registry.inputsOf(node)) {
      const row = h(
        'div',
        { class: 'nm-row nm-in', 'data-port': p.name },
        h('span', { class: 'nm-port', 'data-dir': 'in', 'data-node': node.id, 'data-port': p.name, 'data-type': p.type ?? 'any', title: `${p.name}: ${p.type ?? 'any'}` }),
        h('span', { class: 'nm-label' }, p.label ?? p.name),
        h('span', { class: 'nm-val' }),
      );
      const inline = p.inline ?? (Registry.isPrimitive(p.type) || p.type === 'any');
      if (inline) row.append(h('span', { class: 'nm-inline' }, this.inlineControl(node, p)));
      body.append(row);
    }
    el.append(body, h('div', { class: 'nm-view' }), h('div', { class: 'nm-error' }));
    // A listener on each port makes browsers with touch adjustment snap taps to ports, not nearby inputs.
    el.querySelectorAll('.nm-port').forEach((p) => p.addEventListener('click', noop));

    if (old) {
      this.resizeObs?.unobserve(old.el);
      old.el.replaceWith(el);
      if (this.selected.node === node.id) el.classList.add('nm-selected');
    } else this.viewportEl.append(el);
    this.records.set(node.id, { el, portsKey: this.portsKey(node), offsets: new Map() });
    this.place(node);
    this.resizeObs?.observe(el);

    if (focusKey) {
      const again = el.querySelector<HTMLInputElement>(`[data-key="${CSS.escape(focusKey)}"]`);
      again?.focus({ preventScroll: true });
      if (again && sel && sel[0] != null) {
        try {
          again.setSelectionRange(sel[0], sel[1]);
        } catch {
          /* not a text input */
        }
      }
    }
    const result = this.evaluator?.results.get(node.id);
    if (result) this.showResult(node.id, result);
  }

  private paramControl(node: NodeInstance, p: ParamDef): HTMLElement {
    const set = (v: unknown) => this.graph.setParam(node.id, p.name, v);
    const value = node.params[p.name] ?? p.default;
    const key = `p:${p.name}`;
    switch (p.kind) {
      case 'number': {
        const numEl = h('input', { type: 'number', inputmode: 'decimal', 'data-key': key + ':n', step: String(p.step ?? 'any'), 'aria-label': p.label ?? p.name });
        numEl.value = String(value ?? 0);
        numEl.addEventListener('input', () => numEl.value !== '' && !isNaN(+numEl.value) && set(+numEl.value));
        if (p.min === undefined || p.max === undefined) return numEl;
        const range = h('input', { type: 'range', 'data-key': key, min: String(p.min), max: String(p.max), step: String(p.step ?? 'any'), 'aria-label': p.label ?? p.name });
        range.value = String(value ?? 0);
        range.addEventListener('input', () => {
          numEl.value = range.value;
          set(+range.value);
        });
        return h('span', { class: 'nm-range' }, range, numEl);
      }
      case 'boolean': {
        const cb = h('input', { type: 'checkbox', 'data-key': key, 'aria-label': p.label ?? p.name });
        cb.checked = !!value;
        cb.addEventListener('change', () => set(cb.checked));
        return cb;
      }
      case 'select': {
        const s = h('select', { 'data-key': key, 'aria-label': p.label ?? p.name }, ...p.options.map((o) => h('option', { value: o }, o)));
        s.value = String(value ?? p.options[0]);
        s.addEventListener('change', () => set(s.value));
        return s;
      }
      case 'text': {
        const attrs = { 'data-key': key, placeholder: p.placeholder ?? '', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': p.label ?? p.name };
        const t = p.multiline ? h('textarea', { ...attrs, rows: '3' }) : h('input', { ...attrs, type: 'text' });
        t.value = String(value ?? '');
        if (/expr|code|vars|fn/i.test(p.name)) t.classList.add('nm-mono');
        t.addEventListener('input', () => set(t.value));
        return t;
      }
    }
  }

  private inlineControl(node: NodeInstance, p: PortDef): HTMLElement {
    const key = `i:${p.name}`;
    const value = node.params[p.name] ?? p.default;
    const set = (v: unknown) => this.graph.setParam(node.id, p.name, v);
    if (p.type === 'boolean') {
      const cb = h('input', { type: 'checkbox', 'data-key': key, 'aria-label': p.name });
      cb.checked = !!value;
      cb.addEventListener('change', () => set(cb.checked));
      return cb;
    }
    if (p.type === 'number' || (p.type === 'any' && typeof value === 'number')) {
      const n = h('input', { type: 'number', inputmode: 'decimal', step: 'any', 'data-key': key, 'aria-label': p.name });
      n.value = String(value ?? 0);
      n.addEventListener('input', () => n.value !== '' && !isNaN(+n.value) && set(+n.value));
      return n;
    }
    const t = h('input', { type: 'text', 'data-key': key, spellcheck: 'false', autocapitalize: 'off', 'aria-label': p.name });
    t.value = String(value ?? '');
    t.addEventListener('input', () => set(t.value));
    return t;
  }

  /** Push param values changed elsewhere (undo, API) into the node's controls without rebuilding. */
  private syncControls(node: NodeInstance): void {
    const el = this.records.get(node.id)?.el;
    if (!el) return;
    el.querySelectorAll<HTMLInputElement>('[data-key]').forEach((input) => {
      if (input === document.activeElement) return;
      const name = input.dataset.key!.replace(/^[pi]:/, '').replace(/:n$/, '');
      const v = node.params[name];
      if (v === undefined) return;
      if (input.type === 'checkbox') input.checked = !!v;
      else if (input.value !== String(v)) input.value = String(v);
    });
  }

  /** Cache each port's position relative to its node so wires can be drawn without layout reads. */
  private measure(id: string): void {
    const rec = this.records.get(id);
    const node = this.graph.nodes.get(id);
    if (!rec || !node) return;
    const nodeRect = rec.el.getBoundingClientRect();
    rec.offsets.clear();
    rec.el.querySelectorAll<HTMLElement>('.nm-port').forEach((p) => {
      const r = p.getBoundingClientRect();
      rec.offsets.set(`${p.dataset.dir}:${p.dataset.port}`, {
        x: (r.left + r.width / 2 - nodeRect.left) / this.vp.k,
        y: (r.top + r.height / 2 - nodeRect.top) / this.vp.k,
      });
    });
  }

  private portPos(ref: PortRef, dir: Dir): { x: number; y: number } {
    const node = this.graph.nodes.get(ref.node)!;
    const off = this.records.get(ref.node)?.offsets.get(`${dir}:${ref.port}`) ?? { x: dir === 'out' ? 180 : 0, y: 40 };
    return { x: node.x + off.x, y: node.y + off.y };
  }

  private curve(a: { x: number; y: number }, b: { x: number; y: number }): string {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }

  private buildEdge(e: Edge): void {
    const g = document.createElementNS(SVGNS, 'g');
    g.classList.add('nm-edge-g');
    g.dataset.edge = e.id;
    const line = document.createElementNS(SVGNS, 'path');
    line.classList.add('nm-edge');
    const type = this.registry.outputsOf(this.graph.nodes.get(e.from.node)!).find((p) => p.name === e.from.port)?.type;
    if (type) line.setAttribute('data-type', type);
    const hit = document.createElementNS(SVGNS, 'path');
    hit.classList.add('nm-edge-hit');
    hit.dataset.edge = e.id;
    g.append(line, hit);
    this.wires.insertBefore(g, this.tempWire);
    this.edgeEls.set(e.id, g);
    this.drawEdge(e);
  }

  private drawEdge(e: Edge): void {
    const g = this.edgeEls.get(e.id);
    if (!g) return;
    const d = this.curve(this.portPos(e.from, 'out'), this.portPos(e.to, 'in'));
    g.querySelectorAll('path').forEach((p) => p.setAttribute('d', d));
  }

  private drawEdgesOf(nodeId: string): void {
    for (const e of this.graph.edges.values()) if (e.from.node === nodeId || e.to.node === nodeId) this.drawEdge(e);
  }

  /** Mark connected ports and rows. */
  private refreshLinks(): void {
    const linked = new Set<string>();
    for (const e of this.graph.edges.values()) {
      linked.add(`${e.from.node}|out|${e.from.port}`);
      linked.add(`${e.to.node}|in|${e.to.port}`);
    }
    this.viewportEl.querySelectorAll<HTMLElement>('.nm-port').forEach((p) => {
      const on = linked.has(`${p.dataset.node}|${p.dataset.dir}|${p.dataset.port}`);
      p.classList.toggle('nm-linked', on);
      if (p.dataset.dir === 'in') p.parentElement!.classList.toggle('nm-connected', on);
    });
  }

  private showResult(id: string, r: NodeResult): void {
    const rec = this.records.get(id);
    const node = this.graph.nodes.get(id);
    if (!rec || !node) return;
    rec.el.dataset.status = r.status;
    if (r.status === 'running') return;
    rec.el.querySelector('.nm-error')!.textContent = r.status === 'error' ? r.error ?? 'Error' : '';
    for (const row of rec.el.querySelectorAll<HTMLElement>('.nm-out')) {
      const v = r.outputs?.[row.dataset.port!];
      row.querySelector('.nm-val')!.textContent = r.status === 'ok' ? formatValue(v, 24) : '';
    }
    // Show the value arriving at each connected input of downstream nodes.
    for (const e of this.graph.outgoing(id)) {
      const row = this.records.get(e.to.node)?.el.querySelector<HTMLElement>(`.nm-in[data-port="${CSS.escape(e.to.port)}"] .nm-val`);
      if (row) row.textContent = r.status === 'ok' ? formatValue(r.outputs?.[e.from.port], 18) : '';
    }
    const def = this.registry.get(node.type);
    if (def?.view) def.view.render(rec.el.querySelector('.nm-view')!, r, node);
  }

  // ---------------------------------------------------------------- toolbar

  private buildToolbar(): void {
    const btn = (name: keyof typeof icons, label: string, fn: () => void, cls = '') => {
      const b = h('button', { class: `nm-btn ${cls}`, type: 'button', 'aria-label': label, title: label, 'data-action': name });
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
      b.addEventListener('click', fn);
      return b;
    };
    this.toolbar = h(
      'div',
      { class: 'nm-toolbar', role: 'toolbar', 'aria-label': 'Editor' },
      btn('trash', 'Delete selection', () => this.deleteSelection(), 'nm-danger'),
      btn('copy', 'Duplicate node', () => this.duplicateSelection()),
      h('span', { class: 'nm-sep' }),
      btn('undo', 'Undo', () => this.history?.undo()),
      btn('redo', 'Redo', () => this.history?.redo()),
      btn('fit', 'Show whole map', () => this.fit({ minScale: 0 })),
      btn('plus', 'Add node', () => this.openPalette(), 'nm-primary'),
    );
    this.toolbar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.append(this.toolbar);
    this.updateToolbar();
  }

  private updateToolbar(): void {
    if (!this.toolbar) return;
    const q = (a: string) => this.toolbar!.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)!;
    const hasSel = !!(this.selected.node || this.selected.edge);
    q('trash').hidden = !hasSel;
    q('copy').hidden = !this.selected.node;
    (this.toolbar.querySelector('.nm-sep') as HTMLElement).hidden = !hasSel;
    q('undo').hidden = q('redo').hidden = !this.history;
    // History commits after a short settle delay, so re-check shortly after edits.
    const sync = () => {
      if (!this.history) return;
      q('undo').disabled = !this.history.canUndo;
      q('redo').disabled = !this.history.canRedo;
    };
    sync();
    setTimeout(sync, 350);
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const root = this.root;
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      root.addEventListener(t, fn as EventListener, o);
      this.disposers.push(() => root.removeEventListener(t, fn as EventListener, o));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e));
    on('pointercancel', (e) => this.onUp(e, true));
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('contextmenu', (e) => {
      if (!(e.target as Element).closest('input,textarea,select')) e.preventDefault();
    });
    on('keydown', (e) => {
      const t = e.target as Element;
      if (t.closest('input,textarea,select')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelection();
      else if (e.key === 'Escape') this.cancelPending(), this.closePalette(), this.select({});
      else if (mod && e.key.toLowerCase() === 'z') e.shiftKey ? this.history?.redo() : this.history?.undo();
      else if (mod && e.key.toLowerCase() === 'y') this.history?.redo();
      else if (mod && e.key.toLowerCase() === 'd') this.duplicateSelection();
      else if (e.key === 'a' || e.key === 'A' || e.key === ' ') this.openPalette();
      else if (e.key === 'f') this.fit({ minScale: 0 });
      else return;
      e.preventDefault();
    });
  }

  private onWheel(e: WheelEvent): void {
    if ((e.target as Element).closest('.nm-sheet, .nm-view, textarea')) return;
    e.preventDefault();
    // Trackpad pinch arrives as ctrl+wheel; a plain two-finger scroll pans.
    if (e.ctrlKey || e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50 && e.deltaX === 0) {
      this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
    } else this.setViewport({ x: this.vp.x - e.deltaX, y: this.vp.y - e.deltaY });
  }

  private onDown(e: PointerEvent): void {
    const t = e.target as Element;
    if (t.closest('input, select, textarea, button, .nm-sheet, .nm-toolbar, .nm-hud')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }

    if (this.pointers.size === 2) {
      // Second finger: switch whatever is happening to a pinch.
      if (this.gesture?.kind === 'pan') clearTimeout(this.gesture.timer);
      if (this.gesture?.kind === 'wire') this.endWire();
      if (this.gesture?.kind === 'node') this.records.get(this.gesture.id)?.el.classList.remove('nm-dragging');
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, vp: { ...this.vp } };
      return;
    }
    if (this.pointers.size > 2) return;

    const port = t.closest<HTMLElement>('.nm-port');
    const nodeEl = t.closest<HTMLElement>('.nm-node');
    const edgeHit = t.closest<SVGElement>('.nm-edge-hit');
    const base = { sx: e.clientX, sy: e.clientY, moved: false };

    if (port) {
      const anchor: Anchor = { node: port.dataset.node!, port: port.dataset.port!, dir: port.dataset.dir as Dir };
      this.gesture = { kind: 'wire', anchor, ...base };
    } else if (nodeEl) {
      const n = this.graph.nodes.get(nodeEl.dataset.id!)!;
      this.gesture = { kind: 'node', id: n.id, nx: n.x, ny: n.y, ...base };
    } else if (edgeHit) {
      this.gesture = { kind: 'edge', id: (edgeHit as SVGElement).dataset.edge!, vx: this.vp.x, vy: this.vp.y, ...base };
    } else {
      const g: Gesture = { kind: 'pan', vx: this.vp.x, vy: this.vp.y, ...base };
      g.timer = setTimeout(() => {
        if (this.gesture !== g || g.moved) return;
        this.gesture = null;
        navigator.vibrate?.(12);
        this.openPalette(this.screenToWorld(g.sx, g.sy), this.pending ?? undefined);
        this.cancelPending();
      }, this.opts.longPressMs);
      this.gesture = g;
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    if (!g) return;

    if (g.kind === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      if (!b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const r = this.root.getBoundingClientRect();
      const k = Math.min(this.opts.maxZoom, Math.max(this.opts.minZoom, g.vp.k * (dist / g.dist)));
      // Keep the world point under the starting midpoint under the current midpoint.
      const wx = (g.mx - r.left - g.vp.x) / g.vp.k;
      const wy = (g.my - r.top - g.vp.y) / g.vp.k;
      this.setViewport({ k, x: mx - r.left - wx * k, y: my - r.top - wy * k });
      return;
    }

    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) > TAP) {
      g.moved = true;
      if (g.kind === 'pan') clearTimeout(g.timer);
      if (g.kind === 'node') this.records.get(g.id)?.el.classList.add('nm-dragging');
      if (g.kind === 'wire') this.beginWire(g);
    }
    if (!g.moved) return;

    if (g.kind === 'pan' || g.kind === 'edge') this.setViewport({ x: g.vx + dx, y: g.vy + dy });
    else if (g.kind === 'node') this.graph.moveNode(g.id, Math.round(g.nx + dx / this.vp.k), Math.round(g.ny + dy / this.vp.k));
    else if (g.kind === 'wire') {
      const from = this.portPos(g.anchor, g.anchor.dir);
      const to = this.screenToWorld(e.clientX, e.clientY);
      this.tempWire.setAttribute('d', g.anchor.dir === 'out' ? this.curve(from, to) : this.curve(to, from));
      this.viewportEl.querySelectorAll('.nm-hover').forEach((p) => p.classList.remove('nm-hover'));
      this.targetAt(e.clientX, e.clientY, g.anchor)?.el.classList.add('nm-hover');
    }
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.sheetGuard === Infinity) this.sheetGuard = performance.now() + 350;
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size === 0) this.gesture = null;
      return;
    }
    this.gesture = null;
    if (g.kind === 'pan') clearTimeout(g.timer);
    if (cancelled) {
      if (g.kind === 'wire' && g.moved) this.endWire();
      return;
    }

    switch (g.kind) {
      case 'pan':
        if (!g.moved) {
          if (this.pending) this.cancelPending();
          else this.select({});
        }
        break;
      case 'edge':
        if (!g.moved) this.select({ edge: g.id });
        break;
      case 'node':
        this.records.get(g.id)?.el.classList.remove('nm-dragging');
        if (!g.moved) {
          if (this.pending && this.pending.node !== g.id) {
            const p = this.pending;
            this.cancelPending();
            this.autoConnect(p, g.id);
          } else this.select({ node: g.id });
        }
        break;
      case 'wire': {
        if (!g.moved) return this.tapPort(g.anchor);
        const target = this.targetAt(e.clientX, e.clientY, g.anchor);
        const anchor = g.anchor;
        this.endWire();
        if (target) this.tryConnect(anchor, target.anchor);
        else {
          const overNode = this.nodeAt(e.clientX, e.clientY);
          if (overNode && overNode !== anchor.node) this.autoConnect(anchor, overNode);
          else if (!overNode) this.openPalette(this.screenToWorld(e.clientX, e.clientY), anchor);
        }
        break;
      }
    }
  }

  private beginWire(g: Extract<Gesture, { kind: 'wire' }>): void {
    // Dragging from a connected input picks up the existing wire from its source.
    if (g.anchor.dir === 'in') {
      const existing = this.graph.incoming(g.anchor.node).find((e) => e.to.port === g.anchor.port);
      if (existing) {
        this.graph.disconnect(existing.id);
        g.detached = existing;
        g.anchor = { ...existing.from, dir: 'out' };
      }
    }
    this.cancelPending();
    this.highlight(g.anchor);
  }

  private endWire(): void {
    this.tempWire.removeAttribute('d');
    this.clearHighlight();
  }

  private tapPort(anchor: Anchor): void {
    const p = this.pending;
    if (p && p.dir !== anchor.dir && p.node !== anchor.node) {
      this.cancelPending();
      this.tryConnect(p, anchor);
      return;
    }
    if (p && p.node === anchor.node && p.port === anchor.port && p.dir === anchor.dir) return this.cancelPending();
    this.cancelPending();
    this.pending = anchor;
    this.highlight(anchor);
    this.hud.textContent = '';
    const cancel = h('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', () => this.cancelPending());
    this.hud.append(anchor.dir === 'out' ? 'Tap an input to connect' : 'Tap an output to connect', cancel);
    this.hud.hidden = false;
  }

  private cancelPending(): void {
    if (!this.pending) return;
    this.pending = null;
    this.hud.hidden = true;
    this.clearHighlight();
  }

  private ends(a: Anchor, b: Anchor): { from: PortRef; to: PortRef } | null {
    if (a.dir === b.dir) return null;
    const [o, i] = a.dir === 'out' ? [a, b] : [b, a];
    return { from: { node: o.node, port: o.port }, to: { node: i.node, port: i.port } };
  }

  private tryConnect(a: Anchor, b: Anchor): boolean {
    const ends = this.ends(a, b);
    if (!ends) {
      this.notify(a.dir === 'out' ? 'Connect an output to an input' : 'Connect an input to an output');
      return false;
    }
    try {
      this.graph.connect(ends.from, ends.to);
      return true;
    } catch (err) {
      this.notify(err instanceof ConnectionError ? err.message : String(err));
      return false;
    }
  }

  /** Connect `anchor` to the best matching port on `nodeId` (an unconnected compatible one first). */
  private autoConnect(anchor: Anchor, nodeId: string): void {
    const node = this.graph.nodes.get(nodeId);
    if (!node) return;
    const ports = anchor.dir === 'out' ? this.registry.inputsOf(node) : this.registry.outputsOf(node);
    const dir: Dir = anchor.dir === 'out' ? 'in' : 'out';
    const candidates = ports
      .map((p) => ({ node: nodeId, port: p.name, dir }))
      .filter((c) => {
        const ends = this.ends(anchor, c)!;
        return !this.graph.canConnect(ends.from, ends.to);
      });
    const free = candidates.find((c) => dir === 'out' || !this.graph.incoming(nodeId).some((e) => e.to.port === c.port));
    const pick = free ?? candidates[0];
    if (pick) this.tryConnect(anchor, pick);
    else this.notify('No compatible port on that node');
  }

  private highlight(anchor: Anchor): void {
    this.root.classList.add('nm-connecting');
    this.viewportEl.querySelectorAll<HTMLElement>('.nm-port').forEach((el) => {
      const c: Anchor = { node: el.dataset.node!, port: el.dataset.port!, dir: el.dataset.dir as Dir };
      const isAnchor = c.node === anchor.node && c.port === anchor.port && c.dir === anchor.dir;
      el.classList.toggle('nm-anchor', isAnchor);
      const ends = this.ends(anchor, c);
      el.classList.toggle('nm-ok', !!ends && !this.graph.canConnect(ends.from, ends.to));
    });
  }

  private clearHighlight(): void {
    this.root.classList.remove('nm-connecting');
    this.viewportEl.querySelectorAll('.nm-ok, .nm-anchor, .nm-hover').forEach((el) => el.classList.remove('nm-ok', 'nm-anchor', 'nm-hover'));
  }

  /** The compatible port nearest to a screen point, within a finger-sized radius. */
  private targetAt(cx: number, cy: number, anchor: Anchor): { el: HTMLElement; anchor: Anchor } | null {
    let best: { el: HTMLElement; anchor: Anchor } | null = null;
    let bestD = 36;
    this.viewportEl.querySelectorAll<HTMLElement>('.nm-port.nm-ok').forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = { el, anchor: { node: el.dataset.node!, port: el.dataset.port!, dir: el.dataset.dir as Dir } };
      }
    });
    return best;
  }

  private nodeAt(cx: number, cy: number): string | null {
    for (const [id, rec] of this.records) {
      const r = rec.el.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return id;
    }
    return null;
  }

  private portDef(a: Anchor): PortDef | undefined {
    const n = this.graph.nodes.get(a.node);
    if (!n) return;
    return (a.dir === 'out' ? this.registry.outputsOf(n) : this.registry.inputsOf(n)).find((p) => p.name === a.port);
  }
}

const noop = () => {};

function defaults(t: NodeType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  t.params?.forEach((p) => (out[p.name] = p.default));
  return out;
}
