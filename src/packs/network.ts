import { defineNode, definePack, extendNode, type GraphEngine } from '../core/registry.js';
import type { NodeInstance, NodeResult, NodeType } from '../core/types.js';

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

const icons = {
  internet: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  router: svg('<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M11 16.5h.01M8 9a5 5 0 0 1 8 0M5.5 6.5a8.5 8.5 0 0 1 13 0"/>'),
  firewall: svg('<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  switch: svg('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h.01M10 12h.01M13 12h.01M16 12h.01"/>'),
  ap: svg('<path d="M12 20v-6M8.5 10.5a5 5 0 0 1 7 0M5.5 7.5a9 9 0 0 1 13 0"/><circle cx="12" cy="13" r="1"/>'),
  server: svg('<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M8 6.5h.01M8 17.5h.01"/>'),
  laptop: svg('<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>'),
  phone: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
};

const link = (multiple = true) => ({ type: 'link', multiple });

export const SERVER_TYPES = ['Application', 'Web', 'Database', 'File / NAS', 'Mail', 'DNS', 'Media', 'Game', 'Backup', 'Other'];

const storageText = (gb: number) => (gb >= 1024 ? `${Math.round((gb / 1024) * 10) / 10} TB` : `${gb} GB`);

/** A one-line summary of a device's hardware, e.g. "Database · 8 cores · 32 GB RAM · 2 TB · Linux". */
export function deviceSpecs(node: Pick<NodeInstance, 'type' | 'params'>): string {
  const p = node.params;
  if (node.type === 'net/server') {
    return [p.kind ?? 'Application', `${p.cores ?? 4} cores`, `${p.memory ?? 16} GB RAM`, storageText(Number(p.storage ?? 512)), p.os ?? 'Linux'].join(' · ');
  }
  return p.os ? String(p.os) : '';
}

/**
 * The base every device extends. Third parties can add their own devices the same way:
 *   extendNode(device, { type: 'acme/nas', title: 'NAS', meta: { role: 'server' }, … })
 */
export const device = defineNode({
  type: 'net/device',
  title: 'Device',
  category: 'Devices',
  color: '#0ca678',
  width: 200,
  inputs: { uplink: link() },
  params: [
    { name: 'up', label: 'powered', kind: 'boolean', default: true },
    { name: 'ip', label: 'IP address', kind: 'text', default: '', placeholder: 'e.g. 192.168.1.10', description: 'IPv4 address. Duplicates are flagged.', advanced: true },
    { name: 'latency', label: 'latency ms', kind: 'number', default: 1, min: 0, max: 50, step: 0.5, advanced: true },
    { name: 'bandwidth', label: 'Mbps', kind: 'select', default: '1000', options: ['10', '100', '300', '1000', '10000'], advanced: true },
  ],
  meta: { role: 'device' },
});

// ------------------------------------------------------------------ view

const fmtBw = (mbps: number) => (!Number.isFinite(mbps) ? '∞' : mbps >= 1000 ? `${mbps / 1000} Gbps` : `${mbps} Mbps`);

/** Shows the engine's verdict on each device. Exported so third-party devices can reuse it. */
export const statusView = {
  render(el: HTMLElement, r: NodeResult | undefined, node?: NodeInstance) {
    const s = r?.outputs?.status as NetworkStatus | undefined;
    if (!s) {
      el.textContent = '';
      return;
    }
    const label = { source: 'upstream', online: 'online', offline: 'offline', down: 'powered off', blocking: 'blocking' }[s.state];
    const facts =
      s.state === 'online' || s.state === 'blocking'
        ? `<span>${s.latency} ms</span><span>${s.hops} hop${s.hops === 1 ? '' : 's'}</span><span>${fmtBw(s.bandwidth!)}</span>`
        : s.state === 'source'
          ? `<span>${s.latency} ms</span>`
          : '';
    const path = s.state === 'online' ? `<span class="nm-net-path" data-ok="${s.redundant}">${s.redundant ? '2+ paths' : 'single path'}</span>` : '';
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const ip = s.ip ? `<span class="nm-net-ip" data-bad="${!!s.ipIssue}" title="${esc(s.ipIssue ?? '')}">${esc(s.ip)}${s.ipIssue ? ' ⚠' : ''}</span>` : '';
    const specs = node ? deviceSpecs(node) : '';
    const spec = specs ? `<span class="nm-net-spec">${esc(specs)}</span>` : '';
    el.innerHTML = `<div class="nm-net" data-state="${s.state}"><b>${label}</b>${facts}${ip}${spec}${path}</div>`;
  },
};

const nodes: NodeType[] = [
  defineNode({
    type: 'net/internet',
    title: 'Internet',
    category: 'Edge',
    color: '#1971c2',
    icon: icons.internet,
    width: 190,
    description: 'Where traffic comes from. Everything else is measured from here.',
    outputs: { wan: 'link' },
    params: [{ name: 'latency', label: 'upstream ms', kind: 'number', default: 12, min: 0, max: 200, step: 1 }],
    meta: { role: 'internet' },
  }),
  extendNode(device, {
    type: 'net/router',
    title: 'Router',
    category: 'Edge',
    color: '#1971c2',
    icon: icons.router,
    tags: ['gateway', 'nat'],
    inputs: { uplink: { ...link(), label: 'wan' } },
    outputs: { lan: 'link' },
    meta: { role: 'router' },
  }),
  extendNode(device, {
    type: 'net/firewall',
    title: 'Firewall',
    category: 'Edge',
    color: '#e8590c',
    icon: icons.firewall,
    flavor: 'control',
    description: 'Blocks everything behind it when "allow" is off',
    outputs: { protected: 'link' },
    params: [{ name: 'allow', label: 'allow traffic', kind: 'boolean', default: true }],
    meta: { role: 'firewall' },
  }),
  extendNode(device, {
    type: 'net/switch',
    title: 'Switch',
    category: 'Core',
    icon: icons.switch,
    outputs: { ports: 'link' },
    params: [{ name: 'latency', kind: 'number', label: 'latency ms', default: 0.2, min: 0, max: 10, step: 0.1, advanced: true }],
    meta: { role: 'switch' },
  }),
  extendNode(device, {
    type: 'net/ap',
    title: 'Wi-Fi access point',
    category: 'Core',
    icon: icons.ap,
    tags: ['wireless', 'wifi'],
    outputs: { clients: 'link' },
    params: [
      { name: 'latency', kind: 'number', label: 'latency ms', default: 4, min: 0, max: 50, step: 0.5, advanced: true },
      { name: 'bandwidth', label: 'Mbps', kind: 'select', default: '300', options: ['54', '300', '1200', '2400'], advanced: true },
    ],
    meta: { role: 'ap' },
  }),
  extendNode(device, {
    type: 'net/server',
    title: 'Server',
    category: 'Endpoints',
    color: '#7048e8',
    icon: icons.server,
    inputs: { uplink: { type: 'link', multiple: true, label: 'nic' } },
    params: [
      { name: 'kind', label: 'type', kind: 'select', default: 'Application', options: SERVER_TYPES },
      { name: 'cores', label: 'CPU cores', kind: 'number', default: 4, min: 1, max: 128, step: 1, advanced: true },
      { name: 'memory', label: 'RAM (GB)', kind: 'select', default: '16', options: ['2', '4', '8', '16', '32', '64', '128', '256', '512', '1024'], advanced: true },
      { name: 'storage', label: 'storage (GB)', kind: 'number', default: 512, step: 64, advanced: true },
      { name: 'os', label: 'OS', kind: 'select', default: 'Linux', options: ['Linux', 'Windows Server', 'FreeBSD', 'macOS'], advanced: true },
    ],
    tags: ['host', 'database', 'web', 'nas', 'vm'],
    meta: { role: 'endpoint' },
  }),
  extendNode(device, {
    type: 'net/laptop',
    title: 'Laptop',
    category: 'Endpoints',
    color: '#7048e8',
    icon: icons.laptop,
    params: [
      { name: 'bandwidth', label: 'Mbps', kind: 'select', default: '1000', options: ['100', '300', '1000'], advanced: true },
      { name: 'os', label: 'OS', kind: 'select', default: 'macOS', options: ['macOS', 'Windows', 'Linux', 'ChromeOS'], advanced: true },
    ],
    meta: { role: 'endpoint' },
  }),
  extendNode(device, {
    type: 'net/phone',
    title: 'Phone',
    category: 'Endpoints',
    color: '#7048e8',
    icon: icons.phone,
    params: [
      { name: 'bandwidth', label: 'Mbps', kind: 'select', default: '300', options: ['54', '300', '1200'], advanced: true },
      { name: 'os', label: 'OS', kind: 'select', default: 'iOS', options: ['iOS', 'Android'], advanced: true },
    ],
    meta: { role: 'endpoint' },
  }),
].map((n) => ({ ...n, view: statusView, params: ordered(n.params) }));

/** Show what makes a device itself first (power, then its own specs), generic network settings last. */
function ordered(params: NodeType['params']): NodeType['params'] {
  if (!params) return params;
  const generic = ['ip', 'latency', 'bandwidth'];
  const rank = (name: string) => (name === 'up' ? 0 : generic.includes(name) ? 2 : 1);
  return [...params].sort((a, b) => rank(a.name) - rank(b.name));
}

// ------------------------------------------------------------------ addressing

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** IP problems per node: bad format, or the same address on two devices. */
export function ipIssues(nodes: Iterable<NodeInstance>): Map<string, string> {
  const issues = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const n of nodes) {
    const ip = String(n.params.ip ?? '').trim();
    if (!ip) continue;
    if (!IPV4.test(ip)) {
      issues.set(n.id, `“${ip}” is not an IPv4 address`);
      continue;
    }
    const other = seen.get(ip);
    if (other) {
      issues.set(n.id, `${ip} is also used by another device`);
      issues.set(other, `${ip} is also used by another device`);
    } else seen.set(ip, n.id);
  }
  return issues;
}

// ------------------------------------------------------------------ engine

export interface NetworkStatus {
  state: 'source' | 'online' | 'offline' | 'down' | 'blocking';
  ip?: string;
  /** What is wrong with the IP address, if anything. */
  ipIssue?: string;
  latency?: number;
  hops?: number;
  bandwidth?: number;
  /** Still reachable if the next hop towards the internet fails. */
  redundant?: boolean;
}

/**
 * Treats wires as cables (direction does not matter) and works out, for every device, the
 * fastest path to the internet: total latency, hop count, bottleneck bandwidth, and whether a
 * second path exists. Powered-off devices and closed firewalls stop traffic.
 */
export const networkEngine: GraphEngine = {
  name: 'Network reachability',
  async run({ graph, registry, publish }) {
    const nodes = [...graph.nodes.values()];
    const role = (n: NodeInstance) => String(registry.get(n.type)?.meta?.role ?? 'device');
    const latency = (n: NodeInstance) => Math.max(0, Number(n.params.latency ?? 1) || 0);
    const bandwidth = (n: NodeInstance) => (role(n) === 'internet' ? Infinity : Number(n.params.bandwidth ?? 1000) || Infinity);
    const passes = (n: NodeInstance) => n.params.up !== false && !(role(n) === 'firewall' && n.params.allow === false);
    const adj = new Map(nodes.map((n) => [n.id, new Set<string>()]));
    for (const e of graph.edges.values()) {
      adj.get(e.from.node)?.add(e.to.node);
      adj.get(e.to.node)?.add(e.from.node);
    }

    type Best = { latency: number; hops: number; bandwidth: number; prev?: string };
    const shortest = (without?: string) => {
      const best = new Map<string, Best>();
      const queue: string[] = [];
      for (const n of nodes) {
        if (role(n) === 'internet' && n.id !== without) {
          best.set(n.id, { latency: latency(n), hops: 0, bandwidth: Infinity });
          queue.push(n.id);
        }
      }
      // Small graphs: a simple Dijkstra over an array is plenty.
      while (queue.length) {
        queue.sort((a, b) => best.get(a)!.latency - best.get(b)!.latency);
        const u = queue.shift()!;
        const un = graph.nodes.get(u)!;
        if (!passes(un) && role(un) !== 'internet') continue;
        for (const v of adj.get(u) ?? []) {
          if (v === without) continue;
          const vn = graph.nodes.get(v)!;
          if (vn.params.up === false) continue;
          const b = best.get(u)!;
          const cand = { latency: b.latency + latency(vn) + 0.1, hops: b.hops + 1, bandwidth: Math.min(b.bandwidth, bandwidth(vn)), prev: u };
          const cur = best.get(v);
          if (!cur || cand.latency < cur.latency - 1e-9) {
            best.set(v, cand);
            if (!queue.includes(v)) queue.push(v);
          }
        }
      }
      return best;
    };

    const best = shortest();
    const addressing = ipIssues(nodes);
    let online = 0;
    let offline = 0;
    let worst = 0;
    for (const n of nodes) {
      const r = role(n);
      const b = best.get(n.id);
      let status: NetworkStatus;
      let result: NodeResult;
      if (r === 'internet') {
        status = { state: 'source', latency: latency(n) };
        result = { status: 'ok', outputs: { status } };
      } else if (n.params.up === false) {
        status = { state: 'down' };
        result = { status: 'skipped', outputs: { status } };
      } else if (!b) {
        offline++;
        status = { state: 'offline' };
        result = { status: 'error', error: 'No path to the internet', outputs: { status } };
      } else {
        // Is there a second way out if the next hop fails? (The internet itself can't fail.)
        const next = b.prev && role(graph.nodes.get(b.prev)!) !== 'internet' ? b.prev : undefined;
        const redundant = next ? shortest(next).has(n.id) : (adj.get(n.id)?.size ?? 0) > 1;
        status = {
          state: r === 'firewall' && n.params.allow === false ? 'blocking' : 'online',
          latency: Math.round(b.latency * 10) / 10,
          hops: b.hops,
          bandwidth: b.bandwidth,
          redundant,
        };
        if (r === 'endpoint') {
          online++;
          worst = Math.max(worst, b.latency);
        }
        result = { status: 'ok', outputs: { status } };
      }
      const ip = String(n.params.ip ?? '').trim();
      if (ip && result.outputs) {
        const st = result.outputs.status as NetworkStatus;
        st.ip = ip;
        if (addressing.has(n.id)) st.ipIssue = addressing.get(n.id);
      }
      publish(n.id, result);
    }
    return { outputs: { online, offline, worstLatency: Math.round(worst * 10) / 10 } };
  },
};

const css = `
.nm-net { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; font-family: var(--_font); font-size: 11.5px; color: var(--_muted); }
.nm-net b { font-weight: 600; padding: 1px 8px; border-radius: 999px; color: #fff; background: var(--_ok); }
.nm-net[data-state="offline"] b { background: var(--_danger); }
.nm-net[data-state="down"] b, .nm-net[data-state="blocking"] b { background: var(--_muted); }
.nm-net[data-state="source"] b { background: #1971c2; }
.nm-net span { font-variant-numeric: tabular-nums; }
.nm-net-path { width: 100%; }
.nm-net-spec { width: 100%; color: var(--_text); }
.nm-net-ip { width: 100%; font-family: var(--_mono); color: var(--_text); }
.nm-net-ip[data-bad="true"] { color: var(--_danger); }
.nm-net-path[data-ok="false"] { color: #e8590c; }
.nm-net-path[data-ok="true"]::before { content: "✓ "; color: var(--_ok); }
.nm-net-path[data-ok="false"]::before { content: "! "; }
`;

export const networkPack = definePack({
  id: 'nodemap/network',
  title: 'Network',
  portTypes: [{ id: 'link', label: 'Link', color: '#0ca678', inline: false }],
  nodes,
  css,
});
