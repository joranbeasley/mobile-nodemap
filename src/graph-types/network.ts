import { defineGraphType } from '../core/graph-type.js';
import type { GraphJSON } from '../core/types.js';
import { ipIssues, networkEngine, networkPack } from '../packs/network.js';

const N = (id: string, type: string, params: Record<string, unknown> = {}, label?: string) => ({ id, type, x: 0, y: 0, params, ...(label ? { label } : {}) });
const OUT_PORT: Record<string, string> = { 'net/internet': 'wan', 'net/router': 'lan', 'net/firewall': 'protected', 'net/switch': 'ports', 'net/ap': 'clients', 'net/server': 'data' };
const DATA = new Set(['net/disk', 'net/database', 'net/cache', 'net/bucket', 'net/queue']);
/** Build a network map from "a → b" links; ports are picked from the device types. */
function net(nodes: ReturnType<typeof N>[], links: [string, string][]): GraphJSON {
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  return {
    version: 1,
    type: 'network',
    nodes,
    edges: links.map(([a, b]) => ({
      id: `${a}-${b}`,
      from: { node: a, port: OUT_PORT[type.get(a)!] },
      to: { node: b, port: DATA.has(type.get(b)!) ? 'host' : 'uplink' },
    })),
  };
}

/**
 * Network topology: devices linked by cables. Instead of dataflow, an engine works out how
 * every device reaches the internet (latency, hops, bandwidth, redundancy). Loops are allowed.
 */
export const networkGraph = defineGraphType({
  id: 'network',
  title: 'Network',
  description: 'Devices, links and the data behind them. The engine finds each device’s fastest path to the internet, whether it has a backup, and which disks, databases, caches, buckets and queues are reachable.',
  icon: '⌁',
  packs: [networkPack],
  engine: networkEngine,
  rules: {
    allowCycles: true,
    validate: (graph) => [
      ...[...ipIssues(graph.nodes.values())].map(([node, message]) => ({ level: 'warning' as const, message, node })),
      // Data stores need a server to live on.
      ...[...graph.nodes.values()]
        .filter((n) => graph.registry?.get(n.type)?.meta?.role === 'data' && !graph.incoming(n.id).length)
        .map((n) => ({ level: 'warning' as const, message: `${n.label ?? graph.registry?.get(n.type)?.title} is not attached to a server`, node: n.id })),
    ],
    canConnect: (from, to, graph) => {
      const role = (id: string) => graph.registry?.get(graph.nodes.get(id)!.type)?.meta?.role;
      if (role(from.node) === 'internet' && role(to.node) === 'endpoint') return 'Connect devices to the internet through a router';
    },
  },
  editor: { wires: 'smart', autoLayout: true },
  examples: [
    {
      id: 'home',
      name: 'Home',
      description: 'Double-tap a device (or select it and tap the pencil) to rename it, set its IP or power it off.',
      graph: net(
        [
          N('isp', 'net/internet', { latency: 12 }),
          N('router', 'net/router', { ip: '192.168.1.1' }, 'Home router'),
          N('fw', 'net/firewall'),
          N('sw', 'net/switch'),
          N('ap', 'net/ap'),
          N('nas', 'net/server', { latency: 0.5, ip: '192.168.1.10', kind: 'File / NAS', cores: 4, memory: '8', storage: 8192 }, 'NAS'),
          N('desk', 'net/laptop', { ip: '192.168.1.20' }, 'Desk laptop'),
          N('lap', 'net/laptop', { bandwidth: '300', ip: '192.168.1.21' }, 'Sofa laptop'),
          N('phone', 'net/phone', { ip: '192.168.1.22' }, 'Phone'),
          N('drives', 'net/disk', { kind: 'HDD', raid: 'RAID 1', size: 8192, used: 7300, latency: 6 }, 'Media drives'),
          N('photos', 'net/bucket', { provider: 'Backblaze B2', used: 640 }, 'Photo backup'),
        ],
        [
          ['isp', 'router'],
          ['router', 'fw'],
          ['fw', 'sw'],
          ['sw', 'nas'],
          ['sw', 'desk'],
          ['fw', 'ap'],
          ['ap', 'lap'],
          ['ap', 'phone'],
          ['nas', 'drives'],
          ['nas', 'photos'],
        ],
      ),
    },
    {
      id: 'office',
      name: 'Redundant office',
      description: 'Two providers, two routers, a switch ring (a loop) and the data behind the servers. Power off the database server and see what goes dark.',
      graph: net(
        [
          N('isp1', 'net/internet', { latency: 8 }),
          N('isp2', 'net/internet', { latency: 20 }),
          N('r1', 'net/router', { ip: '10.0.0.1' }, 'Router A'),
          N('r2', 'net/router', { ip: '10.0.0.2' }, 'Router B'),
          N('s1', 'net/switch', {}, 'Core switch 1'),
          N('s2', 'net/switch', {}, 'Core switch 2'),
          N('web', 'net/server', { ip: '10.0.1.10', kind: 'Web', cores: 8, memory: '32', storage: 256 }, 'Web server'),
          N('db', 'net/server', { ip: '10.0.1.20', kind: 'Database', cores: 32, memory: '256', storage: 4096 }, 'Database'),
          N('ap', 'net/ap'),
          N('guest', 'net/phone', {}, 'Guest phone'),
          N('orders', 'net/database', { engine: 'PostgreSQL', role: 'primary', size: 500, used: 320 }, 'Orders DB'),
          N('dbvol', 'net/disk', { kind: 'NVMe', raid: 'RAID 10', size: 2048, used: 900 }, 'DB volume'),
          N('sessions', 'net/cache', { engine: 'Redis', size: 16, used: 9, hitRate: 94 }, 'Session cache'),
          N('jobs', 'net/queue', { engine: 'Kafka', backlog: 2400, retention: 7 }, 'Jobs'),
          N('backups', 'net/bucket', { provider: 'S3', used: 3400, versioning: true }, 'Backups'),
        ],
        [
          ['isp1', 'r1'],
          ['isp2', 'r2'],
          ['r1', 's1'],
          ['r2', 's2'],
          ['s1', 's2'],
          ['s2', 's1'],
          ['s1', 'web'],
          ['s2', 'web'],
          ['s1', 'db'],
          ['s2', 'db'],
          ['s2', 'ap'],
          ['ap', 'guest'],
          ['db', 'orders'],
          ['db', 'dbvol'],
          ['web', 'sessions'],
          ['web', 'jobs'],
          ['web', 'backups'],
          ['db', 'backups'],
        ],
      ),
    },
  ],
});
