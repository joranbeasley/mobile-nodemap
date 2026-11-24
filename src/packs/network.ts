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

const dataIcons = {
  disk: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  database: svg('<ellipse cx="12" cy="5" rx="7" ry="2.5"/><path d="M5 5v14c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5"/><path d="M5 10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5M5 15c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>'),
  cache: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  bucket: svg('<path d="M4 6h16l-2 14H6z"/><ellipse cx="12" cy="6" rx="8" ry="2"/>'),
  queue: svg('<rect x="3" y="8" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="8" rx="1"/><rect x="17" y="8" width="4" height="8" rx="1"/>'),
};

export const SERVER_TYPES = ['Application', 'Web', 'Database', 'File / NAS', 'Mail', 'DNS', 'Media', 'Game', 'Backup', 'Other'];

const storageText = (gb: number) => (gb >= 1024 ? `${Math.round((gb / 1024) * 10) / 10} TB` : `${gb} GB`);

/** A one-line summary of a device's hardware, e.g. "Database · 8 cores · 32 GB RAM · 2 TB · Linux". */
export function deviceSpecs(node: Pick<NodeInstance, 'type' | 'params'>): string {
  const p = node.params;
  if (node.type === 'net/server') {
    return [p.kind ?? 'Application', `${p.cores ?? 4} cores`, `${p.memory ?? 16} GB RAM`, storageText(Number(p.storage ?? 512)), p.os ?? 'Linux'].join(' · ');
  }
  switch (node.type) {
    case 'net/disk':
      return [p.kind ?? 'SSD', p.raid && p.raid !== 'none' ? p.raid : ''].filter(Boolean).join(' · ');
    case 'net/database':
      return [p.engine ?? 'PostgreSQL', p.role ?? 'primary'].join(' · ');
    case 'net/cache':
      return [p.engine ?? 'Redis', `${p.hitRate ?? 92}% hits`].join(' · ');
    case 'net/bucket':
      return [p.provider ?? 'S3', p.versioning ? 'versioned' : ''].filter(Boolean).join(' · ');
    case 'net/queue':
      return [p.engine ?? 'Kafka', `${Number(p.backlog ?? 0).toLocaleString('en')} queued`, `${p.retention ?? 7} d retention`].join(' · ');
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
    const label = { source: 'upstream', online: 'online', offline: 'offline', down: 'powered off', blocking: 'blocking', available: 'available', unavailable: 'unavailable' }[s.state];
    const esc0 = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    if (s.state === 'available' || s.state === 'unavailable' || (s.state === 'down' && s.usedGb !== undefined)) {
      // A data store: where it's reached from, how full it is, and anything to watch.
      const pct = s.usage !== undefined ? Math.round(s.usage * 100) : undefined;
      const fill =
        s.usedGb !== undefined
          ? `<span class="nm-net-usage" data-warn="${(s.usage ?? 0) >= 0.85}" title="${pct ?? ''}${pct !== undefined ? '% used' : ''}">${pct !== undefined ? `<i style="width:${Math.min(100, pct)}%"></i>` : ''}</span><span class="nm-net-cap">${storageText(s.usedGb)}${s.sizeGb ? ` of ${storageText(s.sizeGb)}` : ' used'}${pct !== undefined ? ` · ${pct}%` : ''}</span>`
          : '';
      const via = s.state === 'available' ? `<span>${s.latency} ms</span><span>via ${s.hosts} server${s.hosts === 1 ? '' : 's'}</span>` : '';
      const specs = node ? deviceSpecs(node) : '';
      const warn = s.warning ? `<span class="nm-net-warn">⚠ ${esc0(s.warning)}</span>` : '';
      const hostsLine = s.state === 'available' ? `<span class="nm-net-path" data-ok="${s.redundant}">${s.redundant ? '2+ servers' : 'single server'}</span>` : '';
      el.innerHTML = `<div class="nm-net" data-state="${s.state}"><b>${label}</b>${via}${fill}${specs ? `<span class="nm-net-spec">${esc0(specs)}</span>` : ''}${warn}${hostsLine}</div>`;
      return;
    }
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

/**
 * Data: disks, databases, caches, object storage and queues. They attach to servers through a
 * server's "data" output. A store is available while at least one of its servers is online.
 */
export const dataStore = defineNode({
  type: 'net/data',
  title: 'Data store',
  category: 'Data',
  color: '#e67700',
  flavor: 'sink',
  width: 200,
  inputs: { host: { type: 'data', multiple: true, label: 'host', description: 'The server(s) this lives on or is reached through' } },
  params: [
    { name: 'up', label: 'online', kind: 'boolean', default: true },
    { name: 'size', label: 'capacity (GB)', description: '0 means unlimited', kind: 'number', default: 1024, step: 64, advanced: true },
    { name: 'used', label: 'used (GB)', kind: 'number', default: 256, step: 16, advanced: true },
    { name: 'latency', label: 'latency ms', kind: 'number', default: 1, min: 0, max: 50, step: 0.1, advanced: true },
  ],
  meta: { role: 'data' },
});

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
    outputs: { data: { type: 'data', label: 'data', description: 'Attach disks, databases, caches, buckets and queues' } },
    flavor: 'view',
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
  ...dataStores(),
].map((n) => ({ ...n, view: statusView, params: ordered(n.params) }));

function dataStores(): NodeType[] {
  return [
    extendNode(dataStore, {
      type: 'net/disk',
      title: 'Disk / volume',
      icon: dataIcons.disk,
      tags: ['storage', 'ssd', 'hdd', 'raid', 'volume', 'drive'],
      params: [
        { name: 'kind', label: 'type', kind: 'select', default: 'SSD', options: ['SSD', 'NVMe', 'HDD', 'SAN volume'] },
        { name: 'raid', label: 'RAID', kind: 'select', default: 'none', options: ['none', 'RAID 1', 'RAID 5', 'RAID 6', 'RAID 10'], advanced: true },
        { name: 'latency', label: 'latency ms', kind: 'number', default: 0.2, min: 0, max: 50, step: 0.1, advanced: true },
      ],
    }),
    extendNode(dataStore, {
      type: 'net/database',
      title: 'Database',
      icon: dataIcons.database,
      tags: ['db', 'sql', 'postgres', 'mysql', 'mongo'],
      params: [
        { name: 'engine', label: 'engine', kind: 'select', default: 'PostgreSQL', options: ['PostgreSQL', 'MySQL', 'MariaDB', 'SQL Server', 'MongoDB', 'Cassandra', 'SQLite'] },
        { name: 'role', label: 'role', kind: 'select', default: 'primary', options: ['primary', 'replica'], advanced: true },
        { name: 'size', label: 'capacity (GB)', description: '0 means unlimited', kind: 'number', default: 500, step: 50, advanced: true },
        { name: 'used', label: 'used (GB)', kind: 'number', default: 120, step: 10, advanced: true },
        { name: 'latency', label: 'latency ms', kind: 'number', default: 2, min: 0, max: 50, step: 0.1, advanced: true },
      ],
    }),
    extendNode(dataStore, {
      type: 'net/cache',
      title: 'Cache',
      icon: dataIcons.cache,
      tags: ['redis', 'memcached', 'memory'],
      params: [
        { name: 'engine', label: 'engine', kind: 'select', default: 'Redis', options: ['Redis', 'Valkey', 'Memcached', 'Varnish'] },
        { name: 'size', label: 'memory (GB)', kind: 'number', default: 16, step: 1, advanced: true },
        { name: 'used', label: 'used (GB)', kind: 'number', default: 6, step: 1, advanced: true },
        { name: 'hitRate', label: 'hit rate %', kind: 'number', default: 92, min: 0, max: 100, step: 1, advanced: true },
        { name: 'latency', label: 'latency ms', kind: 'number', default: 0.3, min: 0, max: 10, step: 0.1, advanced: true },
      ],
    }),
    extendNode(dataStore, {
      type: 'net/bucket',
      title: 'Object storage',
      icon: dataIcons.bucket,
      tags: ['bucket', 's3', 'blob', 'backup', 'files'],
      params: [
        { name: 'provider', label: 'provider', kind: 'select', default: 'S3', options: ['S3', 'Google Cloud Storage', 'Azure Blob', 'MinIO', 'Backblaze B2'] },
        { name: 'size', label: 'capacity (GB)', description: '0 means unlimited', kind: 'number', default: 0, step: 100, advanced: true },
        { name: 'used', label: 'used (GB)', kind: 'number', default: 1200, step: 100, advanced: true },
        { name: 'versioning', label: 'versioning', kind: 'boolean', default: true, advanced: true },
        { name: 'latency', label: 'latency ms', kind: 'number', default: 20, min: 0, max: 200, step: 1, advanced: true },
      ],
    }),
    extendNode(dataStore, {
      type: 'net/queue',
      title: 'Message queue',
      icon: dataIcons.queue,
      tags: ['kafka', 'rabbitmq', 'sqs', 'events', 'stream'],
      params: [
        { name: 'engine', label: 'engine', kind: 'select', default: 'Kafka', options: ['Kafka', 'RabbitMQ', 'SQS', 'NATS', 'Redis Streams'] },
        { name: 'backlog', label: 'messages waiting', kind: 'number', default: 1200, step: 100 },
        { name: 'retention', label: 'retention (days)', kind: 'number', default: 7, min: 1, max: 90, step: 1, advanced: true },
        { name: 'size', label: 'capacity (GB)', description: '0 means unlimited', kind: 'number', default: 0, step: 64, advanced: true },
        { name: 'used', label: 'used (GB)', kind: 'number', default: 40, step: 8, advanced: true },
      ],
    }),
  ];
}

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
  state: 'source' | 'online' | 'offline' | 'down' | 'blocking' | 'available' | 'unavailable';
  /** Data stores: online servers it can be reached through. */
  hosts?: number;
  /** Data stores: used / capacity (0..1), when the capacity is limited. */
  usage?: number;
  usedGb?: number;
  sizeGb?: number;
  /** Something to look at (nearly full, low hit rate, growing backlog). */
  warning?: string;
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
    // Cables carry traffic; data attachments (server → disk, database…) don't.
    const isData = (id: string) => role(graph.nodes.get(id)!) === 'data';
    for (const e of graph.edges.values()) {
      if (isData(e.from.node) || isData(e.to.node)) continue;
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
    const statusOf = new Map<string, NetworkStatus>();
    for (const n of nodes) {
      const r = role(n);
      if (r === 'data') continue;
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
      statusOf.set(n.id, result.outputs!.status as NetworkStatus);
      publish(n.id, result);
    }

    // Data stores: reachable through any online server they're attached to.
    let dataAvailable = 0;
    let dataUnavailable = 0;
    for (const n of nodes) {
      if (role(n) !== 'data') continue;
      const p = n.params;
      const size = Number(p.size ?? 0) || 0;
      const used = Math.max(0, Number(p.used ?? 0) || 0);
      const usage = size > 0 ? used / size : undefined;
      const base = { usedGb: used, sizeGb: size, usage };
      if (p.up === false) {
        publish(n.id, { status: 'skipped', outputs: { status: { state: 'down', ...base } } });
        continue;
      }
      const hosts = graph
        .incoming(n.id)
        .map((e) => statusOf.get(e.from.node))
        .filter((st): st is NetworkStatus => !!st && st.state === 'online');
      if (!hosts.length) {
        dataUnavailable++;
        const why = graph.incoming(n.id).length ? 'No online server to reach it through' : 'Not attached to a server';
        publish(n.id, { status: 'error', error: why, outputs: { status: { state: 'unavailable', hosts: 0, ...base } } });
        continue;
      }
      dataAvailable++;
      const via = Math.min(...hosts.map((h) => h.latency ?? 0));
      const warning =
        usage !== undefined && usage >= 0.85
          ? `Nearly full: ${Math.round(usage * 100)}%`
          : n.type === 'net/cache' && Number(p.hitRate ?? 100) < 80
            ? `Low hit rate: ${p.hitRate}%`
            : n.type === 'net/queue' && Number(p.backlog ?? 0) > 10000
              ? 'Backlog is growing'
              : undefined;
      const status: NetworkStatus = {
        state: 'available',
        hosts: hosts.length,
        latency: Math.round((via + latency(n)) * 10) / 10,
        redundant: hosts.length > 1,
        warning,
        ...base,
      };
      publish(n.id, { status: 'ok', outputs: { status } });
    }
    return { outputs: { online, offline, worstLatency: Math.round(worst * 10) / 10, dataAvailable, dataUnavailable } };
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
.nm-net[data-state="available"] b { background: var(--_ok); }
.nm-net[data-state="unavailable"] b { background: var(--_danger); }
.nm-net-usage { width: 100%; height: 6px; border-radius: 3px; background: var(--_border); overflow: hidden; display: block; }
.nm-net-usage i { display: block; height: 100%; background: #e67700; border-radius: 3px; }
.nm-net-usage[data-warn="true"] i { background: var(--_danger); }
.nm-net-cap { width: 100%; color: var(--_text); font-variant-numeric: tabular-nums; }
.nm-net-warn { width: 100%; color: var(--_danger); font-weight: 600; }
.nm-net-ip { width: 100%; font-family: var(--_mono); color: var(--_text); }
.nm-net-ip[data-bad="true"] { color: var(--_danger); }
.nm-net-path[data-ok="false"] { color: #e8590c; }
.nm-net-path[data-ok="true"]::before { content: "✓ "; color: var(--_ok); }
.nm-net-path[data-ok="false"]::before { content: "! "; }
`;

export const networkPack = definePack({
  id: 'nodemap/network',
  title: 'Network',
  portTypes: [
    { id: 'link', label: 'Link', color: '#0ca678', inline: false },
    { id: 'data', label: 'Data', color: '#e67700', inline: false },
  ],
  nodes,
  css,
});
