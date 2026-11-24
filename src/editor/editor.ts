import { Emitter } from '../core/emitter.js';
import { Graph, ConnectionError } from '../core/graph.js';
import { History } from '../core/history.js';
import { Registry } from '../core/registry.js';
import type { BuiltinParamDef, Edge, NodeInstance, NodeResult, NodeType, ParamDef, ParamKind, PortDef, PortRef } from '../core/types.js';
import type { Evaluator } from '../runtime/evaluator.js';
import { formatValue } from '../runtime/stdlib.js';
import { injectPackStyles, injectStyles } from './styles.js';
import { flavorOf, getTheme, themeCss, type Theme } from '../themes/index.js';
import { Router } from '../layout/router.js';
import { layered } from '../layout/layered.js';
import { findFreeSpot } from '../layout/place.js';
import { bezierPath, overlaps, roundedPath } from '../layout/geometry.js';
import type { LayoutEngine, LayoutInput, Positions, Rect } from '../layout/types.js';

type Dir = 'in' | 'out';
export interface Anchor extends PortRef {
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
  /** 'smart' (default) routes orthogonal wires around nodes; 'curved' draws classic S-curves. */
  wires?: 'smart' | 'curved';
  /**
   * A theme (object or registered id), or a pair that follows the system setting:
   * `{ light: 'paper', dark: 'graphite' }`. Without one the editor follows the page's colours.
   */
  theme?: string | Theme | { light: string | Theme; dark: string | Theme };
  /** Engine used by autoLayout(). Defaults to the built-in layered layout. */
  layout?: LayoutEngine;
  /** Place new and dropped nodes in free space next to what they connect to. Default true. */
  placement?: boolean;
}

export interface EditorEvents extends Record<string, unknown> {
  select: { node?: string; edge?: string };
  viewport: Viewport;
  error: string;
  theme: Theme;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; timer?: ReturnType<typeof setTimeout> }
  | { kind: 'pinch'; dist: number; mx: number; my: number; vp: Viewport }
  | { kind: 'node'; id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean }
  | { kind: 'wire'; anchor: Anchor; sx: number; sy: number; moved: boolean; detached?: Edge }
  | { kind: 'edge'; id: string; sx: number; sy: number; moved: boolean; vx: number; vy: number };

interface NodeRecord {
  el: HTMLElement;
  w: number;
  h: number;
  portsKey: string;
  offsets: Map<string, { x: number; y: number }>;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const TAP = 8;

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  tidy: '<rect x="3" y="4" width="7" height="5" rx="1.5"/><rect x="14" y="4" width="7" height="5" rx="1.5"/><rect x="14" y="15" width="7" height="5" rx="1.5"/><path d="M10 6.5h4M17.5 9v6"/>',
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
  private themeOff?: () => void;
  private currentTheme?: Theme;
  /** Nodes whose "More" params are open. */
  private expanded = new Set<string>();
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
  private opts: Required<Pick<EditorOptions, 'minZoom' | 'maxZoom' | 'longPressMs' | 'placement'>>;
  private wireStyle: 'smart' | 'curved';
  private layoutEngine: LayoutEngine;
  private routingPaused = false;
  private routeAll = false;
  private routeOnly = new Set<string>();
  private routeFrame = 0;

  constructor(container: HTMLElement, options: EditorOptions) {
    super();
    injectStyles(container.getRootNode() as Document | ShadowRoot);
    this.graph = options.graph;
    this.registry = options.registry;
    this.evaluator = options.evaluator;
    this.opts = {
      minZoom: options.minZoom ?? 0.2,
      maxZoom: options.maxZoom ?? 2.5,
      longPressMs: options.longPressMs ?? 450,
      placement: options.placement ?? true,
    };
    this.wireStyle = options.wires ?? 'smart';
    this.layoutEngine = options.layout ?? layered();
    if (options.history !== false) this.history = new History(this.graph);
    for (const [id, cssText] of this.registry.styles()) injectPackStyles(container.getRootNode() as Document | ShadowRoot, id, cssText);

    this.root = container;
    container.classList.add('nm-root');
    container.dataset.wires = this.wireStyle;
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
            const before = this.records.get(id)!.h;
            this.measure(id);
            if (this.opts.placement && this.records.get(id)!.h > before + 1) this.pushAway(id);
            this.scheduleRoute();
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
    if (options.theme) this.setTheme(options.theme);
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
    if (this.opts.placement) this.place_(copy.id, { axis: 'both' });
    this.select({ node: copy.id });
    this.ensureVisible(copy.id);
  }

  /**
   * Add a node of `type` near a world position (defaults to the middle of the view).
   * With `connectFrom` it is wired to that port and placed beside it, in free space.
   */
  addNode(type: string, at?: { x: number; y: number }, connectFrom?: Anchor): NodeInstance {
    const r = this.root.getBoundingClientRect();
    const p = at ?? this.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    const node = this.graph.addNode(type, { x: Math.round(p.x - 90), y: Math.round(p.y - 30) });
    if (connectFrom) this.autoConnect(connectFrom, node.id);
    if (this.opts.placement) {
      const edge = connectFrom && [...this.graph.edges.values()].find(
        (e) => (e.from.node === connectFrom.node && e.to.node === node.id) || (e.to.node === connectFrom.node && e.from.node === node.id),
      );
      if (edge && connectFrom) {
        // Line the new node's port up with the port it is wired to, one column over.
        const src = this.graph.nodes.get(connectFrom.node)!;
        const srcRec = this.records.get(src.id)!;
        const rec = this.records.get(node.id)!;
        const anchorY = this.portPos(connectFrom, connectFrom.dir).y;
        const own = connectFrom.dir === 'out' ? rec.offsets.get(`in:${edge.to.port}`) : rec.offsets.get(`out:${edge.from.port}`);
        const x = connectFrom.dir === 'out' ? src.x + srcRec.w + 70 : src.x - 70 - rec.w;
        this.graph.moveNode(node.id, Math.round(x), Math.round(anchorY - (own?.y ?? 40)));
        this.makeRoom(node.id, connectFrom);
      } else this.place_(node.id, { axis: 'both' });
    }
    this.select({ node: node.id });
    this.ensureVisible(node.id);
    return node;
  }

  /** Switch between routed ('smart') and curved wires. */
  setWires(style: 'smart' | 'curved'): void {
    this.wireStyle = style;
    this.root.dataset.wires = style;
    this.scheduleRoute();
  }

  get wireMode(): 'smart' | 'curved' {
    return this.wireStyle;
  }

  /** On a narrow portrait canvas, the world width that fits at a readable zoom; otherwise undefined. */
  suggestedMaxWidth(): number | undefined {
    const r = this.root.getBoundingClientRect();
    if (!r.width || r.width >= 720 || r.height < r.width) return undefined;
    return Math.max(420, (r.width - 48) / 0.62);
  }

  setLayout(engine: LayoutEngine): void {
    this.layoutEngine = engine;
  }

  /**
   * Tidy the whole map with the layout engine, animating nodes to their new places.
   * On narrow portrait screens the layout wraps into rows that fit the width at a readable zoom.
   */
  async autoLayout(opts: { animate?: boolean; fit?: boolean; maxWidth?: number } = {}): Promise<void> {
    if (!this.graph.nodes.size) return;
    const input = this.layoutInput();
    input.maxWidth = opts.maxWidth ?? this.suggestedMaxWidth();
    const pos = await this.layoutEngine(input);
    await this.animateTo(pos, opts.animate === false ? 0 : 360);
    if (opts.fit !== false) this.fit();
  }

  /** The snapshot a layout engine works on: node boxes and port offsets as currently rendered. */
  layoutInput(): LayoutInput {
    return {
      nodes: [...this.graph.nodes.values()].map((n) => {
        const rec = this.records.get(n.id);
        return {
          id: n.id,
          x: n.x,
          y: n.y,
          w: rec?.w ?? 180,
          h: rec?.h ?? 80,
          ports: [...(rec?.offsets ?? [])].map(([k, o]) => {
            const [dir, ...name] = k.split(':');
            return { name: name.join(':'), dir: dir as Dir, x: o.x, y: o.y };
          }),
        };
      }),
      edges: [...this.graph.edges.values()].map((e) => ({ id: e.id, from: { ...e.from }, to: { ...e.to } })),
    };
  }

  /** Pan (without zooming) so a node is fully on screen. */
  ensureVisible(id: string, pad = 24): void {
    const n = this.graph.nodes.get(id);
    const rec = this.records.get(id);
    if (!n || !rec) return;
    const r = this.root.getBoundingClientRect();
    const k = this.vp.k;
    const bottomUi = this.toolbar ? 70 : 0;
    const left = n.x * k + this.vp.x;
    const top = n.y * k + this.vp.y;
    let dx = 0;
    let dy = 0;
    if (left < pad) dx = pad - left;
    else if (left + rec.w * k > r.width - pad) dx = Math.max(pad - left, r.width - pad - (left + rec.w * k));
    if (top < pad) dy = pad - top;
    else if (top + rec.h * k > r.height - pad - bottomUi) dy = Math.max(pad - top, r.height - pad - bottomUi - (top + rec.h * k));
    if (dx || dy) this.setViewport({ x: this.vp.x + dx, y: this.vp.y + dy });
  }

  /**
   * The "+" action. With a node selected, the sheet opens ready to add a node wired to it
   * (upstream or downstream, whichever that node needs next); otherwise it adds a free node.
   */
  openAddSheet(): void {
    // A tapped port wins: add a node on that port (downstream of an output, upstream of an input).
    if (this.pending) {
      const p = this.pending;
      this.cancelPending();
      return this.openPalette(undefined, p, { around: p.node });
    }
    if (this.selected.edge && this.graph.edges.has(this.selected.edge)) return this.openPalette(undefined, undefined, { splice: this.selected.edge });
    if (this.selected.node && this.graph.nodes.has(this.selected.node)) return this.openPalette(undefined, undefined, { around: this.selected.node });
    this.openPalette();
  }

  /**
   * Insert a node of `type` into a wire: source → new node → target. Nodes downstream
   * slide right to make a column for it.
   */
  spliceNode(type: string, edgeId: string): NodeInstance | null {
    const e = this.graph.edges.get(edgeId);
    if (!e) return null;
    const from: Anchor = { ...e.from, dir: 'out' };
    const to: Anchor = { ...e.to, dir: 'in' };
    const src = this.graph.nodes.get(e.from.node)!;
    const node = this.graph.addNode(type, { x: src.x, y: src.y });
    this.autoConnect(to, node.id); // replaces the old wire into the target
    this.autoConnect(from, node.id);
    if (this.opts.placement) {
      const rec = this.records.get(node.id)!;
      const edge = this.graph.incoming(node.id).find((x) => x.from.node === from.node);
      const own = edge ? rec.offsets.get(`in:${edge.to.port}`) : undefined;
      const srcRec = this.records.get(src.id)!;
      this.graph.moveNode(node.id, Math.round(src.x + srcRec.w + 70), Math.round(this.portPos(from, 'out').y - (own?.y ?? 40)));
      this.makeRoom(node.id, from);
    }
    this.select({ node: node.id });
    this.ensureVisible(node.id);
    return node;
  }

  /**
   * Make space for a just-placed node without scattering the map. If it lands among the
   * other nodes wired to the same port (siblings), it joins their column and the nodes
   * below shift down; otherwise a column opens up and the nodes beyond it shift sideways.
   * Moves are animated.
   */
  private makeRoom(id: string, from: Anchor): void {
    const n = this.graph.nodes.get(id);
    const rec = this.records.get(id);
    if (!n || !rec) return;
    const gap = 28;
    const colGap = 70;
    const before = new Map([...this.graph.nodes.values()].map((o) => [o.id, { x: o.x, y: o.y }]));
    const size = (oid: string) => this.records.get(oid) ?? { w: 180, h: 80 };
    const others = () => [...this.graph.nodes.values()].filter((o) => o.id !== id);
    const hitsOf = (g: number) =>
      others().filter((o) => overlaps({ x: n.x, y: n.y, w: rec.w, h: rec.h }, { x: o.x, y: o.y, ...size(o.id) }, g));

    const hits = hitsOf(gap - 1);
    if (hits.length) {
      const siblings = new Set(
        (from.dir === 'out' ? this.graph.outgoing(from.node).map((e) => e.to.node) : this.graph.incoming(from.node).map((e) => e.from.node)).filter(
          (x) => x !== id,
        ),
      );
      // Nodes the new one feeds (or is fed by) belong further along the flow, never in its column.
      const along = (oid: string) => (from.dir === 'out' ? this.graph.reaches(id, oid) : this.graph.reaches(oid, id));
      const column = hits.filter((o) => !along(o.id) && (siblings.has(o.id) || Math.abs(o.x - n.x) < rec.w / 2));
      if (column.length) {
        // Join the column under the nodes it collides with, then cascade the rest down.
        const bottom = Math.max(...column.map((o) => o.y + size(o.id).h));
        this.graph.moveNode(id, n.x, Math.round(bottom + gap));
        this.pushAway(id);
      } else if (from.dir === 'out') {
        // Open a column: everything from the first collision rightwards moves right.
        const edge = Math.min(...hits.map((o) => o.x));
        const dx = n.x + rec.w + colGap - edge;
        for (const o of others()) if (o.x >= edge - 1) this.graph.moveNode(o.id, Math.round(o.x + dx), o.y);
      } else {
        const edge = Math.max(...hits.map((o) => o.x + size(o.id).w));
        const dx = edge + colGap - n.x;
        for (const o of others()) if (o.x + size(o.id).w <= edge + 1) this.graph.moveNode(o.id, Math.round(o.x - dx), o.y);
      }
      // Anything still in the way (an unrelated node elsewhere): fall back to the nearest free spot.
      if (hitsOf(8).length) this.place_(id, { axis: 'y' });
    }

    // Animate the neighbours from where they were to where they now belong.
    const moved: Positions = {};
    for (const o of others()) {
      const b = before.get(o.id);
      if (b && (b.x !== o.x || b.y !== o.y)) {
        moved[o.id] = { x: o.x, y: o.y };
        this.graph.moveNode(o.id, b.x, b.y);
      }
    }
    if (Object.keys(moved).length) void this.animateTo(moved, 220);
  }

  /** Which side of `nodeId` a new node most likely belongs on, and which port to use. */
  suggestConnection(nodeId: string): Anchor | null {
    const node = this.graph.nodes.get(nodeId);
    if (!node) return null;
    const outs = this.registry.outputsOf(node);
    const ins = this.registry.inputsOf(node);
    const linkedIn = new Set(this.graph.incoming(nodeId).map((e) => e.to.port));
    const linkedOut = new Set(this.graph.outgoing(nodeId).map((e) => e.from.port));
    const freeIn = ins.find((p) => !linkedIn.has(p.name));
    const freeOut = outs.find((p) => !linkedOut.has(p.name));
    // Downstream when its result is not used yet; upstream when it still has an open input.
    if (outs.length && (freeOut || !freeIn || !ins.length)) return { node: nodeId, port: (freeOut ?? outs[0]).name, dir: 'out' };
    if (ins.length) return { node: nodeId, port: (freeIn ?? ins[0]).name, dir: 'in' };
    return null;
  }

  /**
   * Open the add-node sheet. With `connectFrom`, the new node is wired to that port.
   * With `around`, the sheet lets the person choose to add before or after that node (or unconnected).
   */
  openPalette(at?: { x: number; y: number }, connectFrom?: Anchor, opts: { around?: string; splice?: string } = {}): void {
    this.closePalette();
    this.sheetGuard = this.pointers.size ? Infinity : performance.now() + 350;
    const backdrop = h('div', { class: 'nm-sheet-backdrop' });
    const search = h('input', { type: 'search', placeholder: 'Search nodes', 'aria-label': 'Search nodes', id: 'nm-search' });
    const list = h('div', { class: 'nm-sheet-list', role: 'listbox' });
    const titleEl = h('strong', {}, '');
    const hint = h('small', {}, '');
    const head = h('div', { class: 'nm-sheet-head' }, titleEl);
    const sheet = h('div', { class: 'nm-sheet', role: 'dialog' }, h('div', { class: 'nm-sheet-grip' }), head, list);

    const around = opts.around ? this.graph.nodes.get(opts.around) : undefined;
    const aroundName = around ? around.label ?? this.registry.get(around.type)?.title ?? around.type : '';
    const splice = opts.splice ? this.graph.edges.get(opts.splice) : undefined;
    let anchor: Anchor | undefined = connectFrom ?? (around ? this.suggestConnection(around.id) ?? undefined : undefined);
    if (splice) anchor = { ...splice.from, dir: 'out' };
    const lastPort: Record<Dir, string | undefined> = { in: undefined, out: undefined };
    if (anchor) lastPort[anchor.dir] = anchor.port;

    const describe = () => {
      if (splice) {
        const name = (nid: string) => {
          const x = this.graph.nodes.get(nid)!;
          return x.label ?? this.registry.get(x.type)?.title ?? x.type;
        };
        titleEl.textContent = 'Insert into wire';
        hint.textContent = `Between ${name(splice.from.node)} “${splice.from.port}” and ${name(splice.to.node)} “${splice.to.port}”`;
        return;
      }
      if (!anchor) {
        titleEl.textContent = 'Add a node';
        hint.textContent = around ? `Not connected to ${aroundName}` : '';
        return;
      }
      const n = this.graph.nodes.get(anchor.node);
      const name = n ? n.label ?? this.registry.get(n.type)?.title ?? n.type : '';
      titleEl.textContent = anchor.dir === 'out' ? `Add after ${name}` : `Add before ${name}`;
      hint.textContent = anchor.dir === 'out' ? `Takes its “${anchor.port}” output` : `Feeds its “${anchor.port}” input`;
    };

    // Re-renders the header and the list; set below once both exist.
    let update = () => {};
    if (around) {
      // Before / after / unconnected, then a port picker when there is more than one choice.
      const outs = this.registry.outputsOf(around);
      const ins = this.registry.inputsOf(around);
      const seg = h('div', { class: 'nm-seg', role: 'radiogroup', 'aria-label': 'Where the new node goes' });
      const chips = h('div', { class: 'nm-chips', role: 'radiogroup', 'aria-label': 'Port' });
      const modes: { dir: Dir | null; label: string; enabled: boolean }[] = [
        { dir: 'in', label: `→ ${aroundName}`, enabled: ins.length > 0 },
        { dir: 'out', label: `${aroundName} →`, enabled: outs.length > 0 },
        { dir: null, label: 'Unconnected', enabled: true },
      ];
      const linkedIn = new Set(this.graph.incoming(around.id).map((e) => e.to.port));
      const sync = () => {
        seg.querySelectorAll<HTMLButtonElement>('button').forEach((b, i) =>
          b.setAttribute('aria-checked', String((anchor?.dir ?? null) === modes[i].dir)),
        );
        chips.textContent = '';
        const ports = anchor ? (anchor.dir === 'out' ? outs : ins) : [];
        chips.hidden = ports.length < 2;
        if (ports.length > 1) {
          chips.append(h('span', {}, anchor!.dir === 'out' ? 'from' : 'into'));
          for (const p of ports) {
            const c = h('button', { type: 'button', role: 'radio', 'data-type': p.type ?? 'any', 'aria-checked': String(p.name === anchor!.port) }, p.label ?? p.name);
            if (anchor!.dir === 'in' && linkedIn.has(p.name)) c.title = 'Already connected; the new node replaces that wire';
            c.addEventListener('click', () => {
              anchor = { ...anchor!, port: p.name };
              lastPort[anchor.dir] = p.name;
              update();
            });
            chips.append(c);
          }
        }
        describe();
      };
      modes.forEach((m) => {
        const b = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false' }, m.label);
        b.disabled = !m.enabled;
        b.addEventListener('click', () => {
          if (!m.dir) anchor = undefined;
          else {
            const ports = m.dir === 'out' ? outs : ins;
            const fallback = m.dir === 'in' ? ins.find((p) => !linkedIn.has(p.name)) ?? ins[0] : outs[0];
            anchor = { node: around.id, dir: m.dir, port: lastPort[m.dir] ?? fallback.name };
            if (!ports.some((p) => p.name === anchor!.port)) anchor.port = fallback.name;
          }
          update();
        });
        seg.append(b);
      });
      head.append(hint, seg, chips);
      update = () => {
        sync();
        render();
      };
      sync();
    } else {
      head.append(hint);
      describe();
    }
    head.append(search);
    sheet.setAttribute('aria-label', titleEl.textContent ?? 'Add a node');

    const compatible = (t: NodeType) => {
      const connectFrom = anchor;
      if (!connectFrom) return true;
      if (splice) {
        // Needs an input that takes the source's type and an output the target accepts.
        const probe = { type: t.type, params: defaults(t) };
        const srcType = this.portDef({ ...splice.from, dir: 'out' })?.type;
        const dstType = this.portDef({ ...splice.to, dir: 'in' })?.type;
        return (
          this.registry.inputsOf(probe).some((p) => this.registry.isCompatible(srcType, p.type)) &&
          this.registry.outputsOf(probe).some((p) => this.registry.isCompatible(p.type, dstType))
        );
      }
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
          (t) => compatible(t) && !this.registry.rules.canAddNode?.(t.type, this.graph) && (!q || `${t.title} ${t.type} ${cat} ${t.description ?? ''} ${(t.tags ?? []).join(' ')}`.toLowerCase().includes(q)),
        );
        if (!items.length) continue;
        list.append(h('div', { class: 'nm-sheet-cat' }, cat));
        for (const t of items) {
          const btn = h(
            'button',
            { class: 'nm-sheet-item', type: 'button', style: `--c:${t.color ?? 'var(--nm-muted)'}` },
            t.icon ? iconEl(t.icon) : h('i'),
            t.title ?? t.type,
            h('small', {}, t.description ?? ''),
          );
          btn.addEventListener('click', () => {
            if (performance.now() < this.sheetGuard) return;
            this.closePalette();
            if (splice) this.spliceNode(t.type, splice.id);
            else this.addNode(t.type, at, anchor);
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

  /** Switch theme (see EditorOptions.theme); null returns to the page's colours. */
  setTheme(theme: EditorOptions['theme'] | null): void {
    this.themeOff?.();
    this.themeOff = undefined;
    const root = this.root;
    const clear = () => {
      delete root.dataset.nmTheme;
      delete root.dataset.nmHeader;
      delete root.dataset.nodeColors;
      delete root.dataset.theme;
    };
    if (!theme) return clear();
    const resolve = (t: string | Theme) => (typeof t === 'string' ? getTheme(t) : t);
    const apply = (t: Theme | undefined) => {
      if (!t) return clear();
      const host = root.getRootNode() as Document | ShadowRoot;
      injectPackStyles(host, `theme-${t.id}`, themeCss(t));
      root.dataset.nmTheme = t.id;
      root.dataset.nmHeader = t.header ?? 'tint';
      root.dataset.theme = t.mode;
      if (t.nodeColors === false) root.dataset.nodeColors = 'off';
      else delete root.dataset.nodeColors;
      this.currentTheme = t;
      this.emit('theme', t);
    };
    if (typeof theme === 'object' && 'light' in theme && 'dark' in theme) {
      const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
      const pick = () => apply(resolve(mq?.matches ? theme.dark : theme.light));
      pick();
      mq?.addEventListener('change', pick);
      this.themeOff = () => mq?.removeEventListener('change', pick);
    } else apply(resolve(theme as string | Theme));
  }

  /** The theme in use, if one was set. */
  get theme(): Theme | undefined {
    return this.root.dataset.nmTheme ? this.currentTheme : undefined;
  }

  destroy(): void {
    this.themeOff?.();
    cancelAnimationFrame(this.routeFrame);
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
        this.scheduleRoute();
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
        this.scheduleRoute();
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
    const focused = this.activeElement();
    const active = focused && old?.el.contains(focused) ? (focused as HTMLInputElement) : null;
    const focusKey = active?.dataset.key;
    const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

    const el = h('div', { class: 'nm-node', 'data-id': node.id, role: 'group', 'aria-label': def?.title ?? node.type });
    if (def?.color) el.style.setProperty('--nm-type-color', def.color);
    el.dataset.flavor = flavorOf(def, this.registry.inputsOf(node), this.registry.outputsOf(node));
    if (def?.width) el.style.width = `${def.width}px`;
    el.append(
      h(
        'div',
        { class: 'nm-head' },
        h('span', { class: 'nm-status' }),
        ...(def?.icon ? [iconEl(def.icon)] : []),
        h('span', { class: 'nm-title' }, node.label ?? def?.title ?? node.type),
        h('span', { class: 'nm-cat' }, def?.category ?? ''),
      ),
    );
    const body = h('div', { class: 'nm-body' });
    if (!def) body.append(h('div', { class: 'nm-error' }, `Unknown node type "${node.type}"`));
    const field = (p: ParamDef) => h('label', { class: 'nm-field' }, h('span', {}, p.label ?? p.name), this.paramControl(node, p));
    const params = def?.params ?? [];
    params.filter((p) => !p.advanced).forEach((p) => body.append(field(p)));
    const advanced = params.filter((p) => p.advanced);
    if (advanced.length) {
      const more = h('details', { class: 'nm-more' }, h('summary', {}, `More (${advanced.length})`), ...advanced.map(field));
      if (this.expanded.has(node.id)) more.open = true;
      more.addEventListener('toggle', () => (more.open ? this.expanded.add(node.id) : this.expanded.delete(node.id)));
      body.append(more);
    }
    for (const p of this.registry.outputsOf(node)) {
      body.append(
        h(
          'div',
          { class: 'nm-row nm-out', 'data-port': p.name },
          h('span', { class: 'nm-val' }),
          h('span', { class: 'nm-label' }, p.label ?? p.name),
          this.portEl(node.id, p, 'out'),
        ),
      );
    }
    for (const p of this.registry.inputsOf(node)) {
      const row = h(
        'div',
        { class: 'nm-row nm-in', 'data-port': p.name },
        this.portEl(node.id, p, 'in'),
        h('span', { class: 'nm-label' }, p.label ?? p.name),
        h('span', { class: 'nm-val' }),
      );
      const pt = this.registry.portType(p.type);
      const inline = p.inline ?? (!p.multiple && (pt ? pt.inline !== false && !!pt.inline : Registry.isPrimitive(p.type) || p.type === 'any'));
      if (p.multiple) row.classList.add('nm-multi');
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
    this.records.set(node.id, { el, w: 180, h: 80, portsKey: this.portsKey(node), offsets: new Map() });
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

  private paramControl(node: NodeInstance, param: ParamDef): HTMLElement {
    const set = (v: unknown) => this.graph.setParam(node.id, param.name, v);
    const value = node.params[param.name] ?? param.default;
    const key = `p:${param.name}`;
    const custom = this.registry.paramKind(param.kind);
    if (custom) return this.customControl(custom, node, param, value, key);
    const p = param as BuiltinParamDef;
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
        if (p.code || /expr|code|vars|fn/i.test(p.name)) t.classList.add('nm-mono');
        t.addEventListener('input', () => set(t.value));
        return t;
      }
      default: {
        // A param kind nobody registered: fall back to a text field so the value stays editable.
        const t = h('input', { type: 'text', 'data-key': key, 'aria-label': param.label ?? param.name, title: `No editor for "${param.kind}"` });
        t.value = typeof value === 'string' ? value : JSON.stringify(value ?? '');
        t.addEventListener('input', () => set(t.value));
        return t;
      }
    }
  }

  private customControl(kind: ParamKind, node: NodeInstance, param: ParamDef, value: unknown, key: string): HTMLElement {
    const el = kind.render({ param, node, value, key, set: (v) => this.graph.setParam(node.id, param.name, v) });
    el.dataset.paramKind = kind.kind;
    el.dataset.param = param.name;
    return el;
  }

  private portEl(nodeId: string, p: PortDef, dir: Dir): HTMLElement {
    const type = p.type ?? 'any';
    const pt = this.registry.portType(type);
    const el = h('span', {
      class: 'nm-port' + (p.multiple ? ' nm-port-multi' : ''),
      'data-dir': dir,
      'data-node': nodeId,
      'data-port': p.name,
      'data-type': type,
      title: `${p.label ?? p.name}: ${pt?.label ?? type}${p.multiple ? ' (many)' : ''}${p.description ? ` · ${p.description}` : ''}`,
    });
    if (pt?.color) el.style.setProperty('--nm-port-color', pt.color);
    return el;
  }

  private inlineControl(node: NodeInstance, p: PortDef): HTMLElement {
    const key = `i:${p.name}`;
    const pt = this.registry.portType(p.type);
    const value = node.params[p.name] ?? p.default ?? pt?.default;
    const set = (v: unknown) => this.graph.setParam(node.id, p.name, v);
    const kind = typeof pt?.inline === 'string' ? pt.inline : undefined;
    const custom = kind ? this.registry.paramKind(kind) : undefined;
    if (custom) return this.customControl(custom, node, { name: p.name, kind: custom.kind, label: p.label }, value, key);
    if (p.type === 'boolean' || kind === 'boolean') {
      const cb = h('input', { type: 'checkbox', 'data-key': key, 'aria-label': p.name });
      cb.checked = !!value;
      cb.addEventListener('change', () => set(cb.checked));
      return cb;
    }
    if (p.type === 'number' || kind === 'number' || (p.type === 'any' && typeof value === 'number')) {
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
      if (input === this.activeElement()) return;
      const name = input.dataset.key!.replace(/^[pi]:/, '').replace(/:n$/, '');
      const v = node.params[name];
      if (v === undefined) return;
      if (input.closest('[data-param-kind]')) return;
      if (input.type === 'checkbox') input.checked = !!v;
      else if (input.value !== String(v)) input.value = String(v);
    });
    el.querySelectorAll<HTMLElement>('[data-param-kind]').forEach((ctl) => {
      if (ctl.contains(this.activeElement())) return;
      const v = node.params[ctl.dataset.param!];
      if (v !== undefined) this.registry.paramKind(ctl.dataset.paramKind!)?.update?.(ctl, v);
    });
  }

  /** Cache each port's position relative to its node so wires can be drawn without layout reads. */
  private measure(id: string): void {
    const rec = this.records.get(id);
    const node = this.graph.nodes.get(id);
    if (!rec || !node) return;
    const nodeRect = rec.el.getBoundingClientRect();
    rec.w = rec.el.offsetWidth || nodeRect.width / this.vp.k || 180;
    rec.h = rec.el.offsetHeight || nodeRect.height / this.vp.k || 80;
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
    return bezierPath(a, b);
  }

  private get smart(): boolean {
    return this.wireStyle === 'smart' && !this.routingPaused;
  }

  /** Re-route wires on the next frame: all of them, or (while dragging) just those of one node. */
  private scheduleRoute(only?: string): void {
    if (only) this.routeOnly.add(only);
    else this.routeAll = true;
    if (this.routeFrame) return;
    this.routeFrame = requestAnimationFrame(() => {
      this.routeFrame = 0;
      const all = this.routeAll;
      const only = new Set(this.routeOnly);
      this.routeAll = false;
      this.routeOnly.clear();
      this.routeNow(all ? undefined : only);
    });
  }

  private routeNow(only?: Set<string>): void {
    const edges = [...this.graph.edges.values()].filter((e) => !only || only.has(e.from.node) || only.has(e.to.node));
    if (!this.smart) return edges.forEach((e) => this.setEdgePath(e, this.curve(this.portPos(e.from, 'out'), this.portPos(e.to, 'in'))));
    const rects: Rect[] = [];
    for (const [id, rec] of this.records) {
      const n = this.graph.nodes.get(id);
      if (n) rects.push({ x: n.x, y: n.y, w: rec.w, h: rec.h });
    }
    const router = new Router(rects);
    const ends = edges.map((e) => ({ e, a: this.portPos(e.from, 'out'), b: this.portPos(e.to, 'in') }));
    // Short wires first: they get the direct channels, long ones detour around them.
    ends.sort((p, q) => Math.abs(p.b.x - p.a.x) + Math.abs(p.b.y - p.a.y) - (Math.abs(q.b.x - q.a.x) + Math.abs(q.b.y - q.a.y)));
    for (const { e, a, b } of ends) {
      const pts = router.route(a, b, `${e.from.node}:${e.from.port}`);
      this.setEdgePath(e, pts ? roundedPath(pts, 12) : this.curve(a, b));
    }
  }

  private setEdgePath(e: Edge, d: string): void {
    this.edgeEls.get(e.id)?.querySelectorAll('path').forEach((p) => p.setAttribute('d', d));
  }

  /** Move a node to the nearest spot where it does not overlap others. */
  private place_(id: string, opts: { axis: 'y' | 'both' }): void {
    const n = this.graph.nodes.get(id);
    const rec = this.records.get(id);
    if (!n || !rec) return;
    const spot = findFreeSpot(this.rectsExcept(id), { x: n.x, y: n.y, w: rec.w, h: rec.h }, { axis: opts.axis, gap: 28 });
    if (spot.x !== n.x || spot.y !== n.y) this.graph.moveNode(id, Math.round(spot.x), Math.round(spot.y));
  }

  /** A node grew (a preview or error appeared): slide the nodes it now covers out of the way. */
  private pushAway(id: string, depth = 0): void {
    const n = this.graph.nodes.get(id);
    const rec = this.records.get(id);
    if (!n || !rec || depth > 50 || this.gesture?.kind === 'node') return;
    const box = { x: n.x, y: n.y, w: rec.w, h: rec.h };
    const hit = [...this.graph.nodes.values()]
      .filter((o) => o.id !== id && o.y >= n.y)
      .filter((o) => {
        const r = this.records.get(o.id);
        return r && overlaps(box, { x: o.x, y: o.y, w: r.w, h: r.h }, 8);
      })
      .sort((a, b) => a.y - b.y);
    // Push straight down, keeping the column's order, and cascade to whatever those land on.
    for (const o of hit) {
      this.graph.moveNode(o.id, o.x, Math.round(n.y + rec.h + 28));
      this.pushAway(o.id, depth + 1);
    }
  }

  private rectsExcept(id: string): Rect[] {
    const out: Rect[] = [];
    for (const [oid, rec] of this.records) {
      const o = this.graph.nodes.get(oid);
      if (o && oid !== id) out.push({ x: o.x, y: o.y, w: rec.w, h: rec.h });
    }
    return out;
  }

  /** Animate nodes to new positions; wires draw as curves in flight and are routed on landing. */
  private animateTo(pos: Positions, ms: number): Promise<void> {
    const ids = Object.keys(pos).filter((id) => this.graph.nodes.has(id));
    const from = new Map(ids.map((id) => [id, { x: this.graph.nodes.get(id)!.x, y: this.graph.nodes.get(id)!.y }]));
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!ms || reduce) {
      ids.forEach((id) => this.graph.moveNode(id, pos[id].x, pos[id].y));
      return Promise.resolve();
    }
    this.routingPaused = true;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = 1 - Math.pow(1 - t, 3);
        for (const id of ids) {
          const a = from.get(id)!;
          if (!this.graph.nodes.has(id)) continue;
          this.graph.moveNode(id, Math.round(a.x + (pos[id].x - a.x) * e), Math.round(a.y + (pos[id].y - a.y) * e));
        }
        if (t < 1) requestAnimationFrame(tick);
        else {
          this.routingPaused = false;
          this.scheduleRoute();
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  private buildEdge(e: Edge): void {
    const g = document.createElementNS(SVGNS, 'g');
    g.classList.add('nm-edge-g');
    g.dataset.edge = e.id;
    const line = document.createElementNS(SVGNS, 'path');
    line.classList.add('nm-edge');
    const type = this.registry.outputsOf(this.graph.nodes.get(e.from.node)!).find((p) => p.name === e.from.port)?.type;
    if (type) line.setAttribute('data-type', type);
    const color = this.registry.portType(type)?.color;
    if (color) line.style.setProperty('--nm-port-color', color);
    const hit = document.createElementNS(SVGNS, 'path');
    hit.classList.add('nm-edge-hit');
    hit.dataset.edge = e.id;
    g.append(line, hit);
    this.wires.insertBefore(g, this.tempWire);
    this.edgeEls.set(e.id, g);
    this.drawEdge(e);
  }

  private drawEdge(e: Edge): void {
    if (this.smart) return this.scheduleRoute();
    this.setEdgePath(e, this.curve(this.portPos(e.from, 'out'), this.portPos(e.to, 'in')));
  }

  private drawEdgesOf(nodeId: string): void {
    if (this.smart) {
      // While a node is being dragged only its own wires follow; the rest re-route on drop.
      const dragging = this.gesture?.kind === 'node' && this.gesture.id === nodeId;
      return this.scheduleRoute(dragging ? nodeId : undefined);
    }
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
      row.querySelector('.nm-val')!.textContent = r.status === 'ok' && v !== undefined ? formatValue(v, 24) : '';
    }
    // Show the value arriving at each connected input of downstream nodes.
    for (const e of this.graph.outgoing(id)) {
      const row = this.records.get(e.to.node)?.el.querySelector<HTMLElement>(`.nm-in[data-port="${CSS.escape(e.to.port)}"] .nm-val`);
      const v = r.outputs?.[e.from.port];
      if (row) row.textContent = r.status === 'ok' && v !== undefined && !row.closest('.nm-multi') ? formatValue(v, 18) : '';
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
      btn('tidy', 'Tidy layout', () => void this.autoLayout()),
      btn('fit', 'Show whole map', () => this.fit({ minScale: 0 })),
      btn('plus', 'Add node', () => this.openAddSheet(), 'nm-primary'),
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
      else if (e.key === 'a' || e.key === 'A' || e.key === ' ') this.openAddSheet();
      else if (e.key === 'f') this.fit({ minScale: 0 });
      else if (e.key === 'l') void this.autoLayout();
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
        if (g.moved) {
          this.scheduleRoute();
          const n = this.graph.nodes.get(g.id);
          const rec = this.records.get(g.id);
          if (this.opts.placement && n && rec) {
            const box = { x: n.x, y: n.y, w: rec.w, h: rec.h };
            if (this.rectsExcept(g.id).some((o) => overlaps(box, o, 8))) {
              const spot = findFreeSpot(this.rectsExcept(g.id), box, { axis: 'both', gap: 28 });
              void this.animateTo({ [g.id]: { x: Math.round(spot.x), y: Math.round(spot.y) } }, 180);
            }
          }
        }
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
    const multi = g.anchor.dir === 'in' && this.portDef(g.anchor)?.multiple;
    if (g.anchor.dir === 'in' && !multi) {
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
    this.hud.append(anchor.dir === 'out' ? 'Tap an input, or + for a new node' : 'Tap an output, or + for a new node', cancel);
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

  private activeElement(): Element | null {
    return (this.root.getRootNode() as Document | ShadowRoot).activeElement ?? null;
  }

  private portDef(a: Anchor): PortDef | undefined {
    const n = this.graph.nodes.get(a.node);
    if (!n) return;
    return (a.dir === 'out' ? this.registry.outputsOf(n) : this.registry.inputsOf(n)).find((p) => p.name === a.port);
  }
}

const noop = () => {};

/** A node icon: inline SVG markup from the node type, or a short text / emoji. */
function iconEl(icon: string): HTMLElement {
  const el = h('span', { class: 'nm-icon', 'aria-hidden': 'true' });
  if (icon.trim().startsWith('<svg')) el.innerHTML = icon;
  else el.textContent = icon;
  return el;
}


function defaults(t: NodeType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  t.params?.forEach((p) => (out[p.name] = p.default));
  return out;
}
