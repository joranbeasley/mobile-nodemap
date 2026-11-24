import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Graph, type GraphChange } from '../core/graph.js';
import type { Registry } from '../core/registry.js';
import type { GraphType } from '../core/graph-type.js';
import type { GraphJSON, NodeInstance, NodeResult, NodeView } from '../core/types.js';
import { Evaluator, type EvalReport } from '../runtime/evaluator.js';
import { NodeEditor, type EditorOptions } from '../editor/editor.js';
import type { LayoutEngine } from '../layout/types.js';

const EMPTY: GraphJSON = { version: 1, nodes: [], edges: [] };

export interface NodeMapProps {
  /** What the map can contain. Pass a graph type, or a registry you built (e.g. with useRegistry). */
  registry?: Registry;
  graphType?: GraphType;
  /** A graph you own (see useGraph). Without it the component keeps its own, seeded from defaultValue. */
  graph?: Graph;
  defaultValue?: GraphJSON;
  /** An evaluator you own (see useEvaluator), or false to show the editor without running nodes. */
  evaluator?: Evaluator | false;
  wires?: 'smart' | 'curved';
  /** 'auto' (default): top to bottom on narrow portrait screens, left to right otherwise. */
  direction?: 'auto' | 'LR' | 'TB';
  layout?: LayoutEngine;
  toolbar?: boolean;
  placement?: boolean;
  /** 'light' | 'dark' for the default palette, or a theme (id, object, or { light, dark } pair). */
  theme?: EditorOptions['theme'];
  /** Tidy the map once on mount. */
  autoLayout?: boolean;
  onChange?: (value: GraphJSON, change: GraphChange) => void;
  onSelect?: (selection: { node?: string; edge?: string }) => void;
  onEvaluate?: (report: EvalReport) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * The touch-first node editor as a React component. The ref gives you the NodeEditor
 * (autoLayout(), fit(), addNode(), …). Size it with style or className; it fills its box.
 */
export const NodeMap = forwardRef<NodeEditor | null, NodeMapProps>(function NodeMap(props, ref) {
  const { graph: given, evaluator: givenEval, toolbar, placement } = props;
  const typeRegistry = useMemo(() => (props.registry || !props.graphType ? undefined : props.graphType.createRegistry()), [props.registry, props.graphType]);
  const registry = props.registry ?? typeRegistry ?? given?.registry;
  if (!registry) throw new Error('<NodeMap> needs a registry, a graphType, or a graph that has a registry');
  const autoLayout = props.autoLayout ?? props.graphType?.editor?.autoLayout;
  const el = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<NodeEditor | null>(null);
  const own = useMemo(() => (given ? null : Graph.fromJSON(props.defaultValue ?? EMPTY, registry)), [given, registry]);
  const graph = given ?? own!;
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const ev = givenEval === false ? undefined : givenEval ?? new Evaluator(graph, registry);
    const ed = new NodeEditor(el.current!, {
      graph,
      registry,
      evaluator: ev,
      toolbar,
      placement,
      wires: latest.current.wires ?? latest.current.graphType?.editor?.wires,
      direction: latest.current.direction ?? latest.current.graphType?.editor?.direction,
      layout: latest.current.layout,
    });
    const offs = [
      graph.on('change', (c) => latest.current.onChange?.(graph.toJSON(), c)),
      ed.on('select', (s) => latest.current.onSelect?.(s)),
      ...(ev ? [ev.on('done', (r) => latest.current.onEvaluate?.(r))] : []),
    ];
    let frame = 0;
    if (autoLayout) frame = requestAnimationFrame(() => void ed.autoLayout({ animate: false }));
    setEditor(ed);
    return () => {
      cancelAnimationFrame(frame);
      offs.forEach((off) => off());
      ed.destroy();
      setEditor(null);
    };
  }, [graph, registry, givenEval, toolbar, placement, autoLayout]);

  useEffect(() => {
    if (editor && props.wires && editor.wireMode !== props.wires) editor.setWires(props.wires);
  }, [editor, props.wires]);
  useEffect(() => {
    if (editor && props.layout) editor.setLayout(props.layout);
  }, [editor, props.layout]);
  useEffect(() => {
    if (editor && props.direction) editor.setDirection(props.direction);
  }, [editor, props.direction]);
  const themeKey = typeof props.theme === 'object' ? JSON.stringify(props.theme) : props.theme;
  useEffect(() => {
    if (!editor) return;
    editor.setTheme(props.theme === 'light' || props.theme === 'dark' ? null : props.theme ?? null);
  }, [editor, themeKey]);

  useImperativeHandle(ref, () => editor!, [editor]);

  return (
    <div
      ref={el}
      className={props.className}
      data-theme={props.theme === 'light' || props.theme === 'dark' ? props.theme : undefined}
      style={{ position: 'relative', width: '100%', height: '100%', ...props.style }}
    />
  );
});

/** A registry for a graph type, created once per graph type. */
export function useRegistry(type: GraphType): Registry {
  return useMemo(() => type.createRegistry(), [type]);
}

/** A Graph that lives as long as the component. Pass it to <NodeMap graph={…}>. */
export function useGraph(registry: Registry, initial?: GraphJSON | (() => GraphJSON)): Graph {
  const [graph] = useState(() => Graph.fromJSON(typeof initial === 'function' ? initial() : initial ?? EMPTY, registry));
  return graph;
}

/** The graph's JSON, re-rendering whenever it changes. */
export function useGraphValue(graph: Graph): GraphJSON {
  const cache = useRef<{ version: number; json: GraphJSON }>({ version: -1, json: EMPTY });
  const version = useRef(0);
  return useSyncExternalStore(
    (notify) => graph.on('change', () => (version.current++, notify())),
    () => {
      if (cache.current.version !== version.current) cache.current = { version: version.current, json: graph.toJSON() };
      return cache.current.json;
    },
    () => cache.current.json,
  );
}

/** An Evaluator bound to a graph, stable across renders. Pass it to <NodeMap evaluator={…}>. */
export function useEvaluator(graph: Graph, registry: Registry): Evaluator {
  return useMemo(() => new Evaluator(graph, registry), [graph, registry]);
}

export interface EvaluationState {
  running: boolean;
  outputs: Record<string, unknown>;
  results: Map<string, NodeResult>;
  errors: { node: string; error: string }[];
  durationMs: number;
}

/**
 * Live evaluation results for React UI around the map. When `inputs` is given, it is fed to
 * the map's graph/input nodes and the map re-runs whenever the values change.
 */
export function useEvaluation(evaluator: Evaluator, inputs?: Record<string, unknown>): EvaluationState {
  const [state, setState] = useState<EvaluationState>(() => ({
    running: false,
    outputs: {},
    results: new Map(evaluator.results),
    errors: [],
    durationMs: 0,
  }));
  useEffect(() => {
    const offs = [
      evaluator.on('start', () => setState((s) => ({ ...s, running: true }))),
      evaluator.on('done', (r) =>
        setState({ running: false, outputs: r.outputs, results: new Map(r.results), errors: r.errors, durationMs: r.durationMs }),
      ),
    ];
    return () => offs.forEach((off) => off());
  }, [evaluator]);
  const key = inputs ? JSON.stringify(inputs) : undefined;
  useEffect(() => {
    if (key === undefined) return;
    void evaluator.run({ inputs: JSON.parse(key) });
  }, [evaluator, key]);
  return state;
}

export interface NodeViewProps {
  result: NodeResult | undefined;
  node: NodeInstance;
}

/**
 * Render a node's preview area with a React component:
 *
 *   registry.define({ type: 'view/gauge', …, view: reactView(Gauge) });
 */
export function reactView(Component: ComponentType<NodeViewProps>): NodeView {
  const roots = new Map<HTMLElement, Root>();
  return {
    render(el, result, node) {
      let root = roots.get(el);
      if (!root) {
        root = createRoot(el);
        roots.set(el, root);
      }
      root.render(<Component result={result} node={node} />);
      // Unmount previews whose node element was removed from the page.
      queueMicrotask(() => {
        for (const [e, r] of roots) if (!e.isConnected) roots.delete(e), r.unmount();
      });
    },
  };
}
