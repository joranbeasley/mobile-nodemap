import { defineGraphType } from '../core/graph-type.js';
import type { GraphJSON } from '../core/types.js';
import { networkEngine, networkPack } from '../packs/network.js';

const N = (id: string, type: string, params: Record<string, unknown> = {}) => ({ id, type, x: 0, y: 0, params });
const OUT_PORT: Record<string, string> = { 'net/internet': 'wan', 'net/router': 'lan', 'net/firewall': 'protected', 'net/switch': 'ports', 'net/ap': 'clients' };
/** Build a network map from "a → b" links; ports are picked from the device types. */
function net(nodes: ReturnType<typeof N>[], links: [string, string][]): GraphJSON {
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  return {
    version: 1,
    type: 'network',
    nodes,
    edges: links.map(([a, b]) => ({ id: `${a}-${b}`, from: { node: a, port: OUT_PORT[type.get(a)!] }, to: { node: b, port: 'uplink' } })),
  };
}

/**
 * Network topology: devices linked by cables. Instead of dataflow, an engine works out how
 * every device reaches the internet (latency, hops, bandwidth, redundancy). Loops are allowed.
 */
export const networkGraph = defineGraphType({
  id: 'network',
  title: 'Network',
  description: 'Devices and links. The engine finds each device’s fastest path to the internet and whether it has a backup.',
  icon: '⌁',
  packs: [networkPack],
  engine: networkEngine,
  rules: {
    allowCycles: true,
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
      description: 'Turn the access point off, or a firewall’s “allow traffic”, and watch who goes offline.',
      graph: net(
        [
          N('isp', 'net/internet', { latency: 12 }),
          N('router', 'net/router'),
          N('fw', 'net/firewall'),
          N('sw', 'net/switch'),
          N('ap', 'net/ap'),
          N('nas', 'net/server', { latency: 0.5 }),
          N('desk', 'net/laptop'),
          N('lap', 'net/laptop', { bandwidth: '300' }),
          N('phone', 'net/phone'),
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
        ],
      ),
    },
    {
      id: 'office',
      name: 'Redundant office',
      description: 'Two providers, two routers and a switch ring (a loop). Power off a router: servers keep a path.',
      graph: net(
        [
          N('isp1', 'net/internet', { latency: 8 }),
          N('isp2', 'net/internet', { latency: 20 }),
          N('r1', 'net/router'),
          N('r2', 'net/router'),
          N('s1', 'net/switch'),
          N('s2', 'net/switch'),
          N('web', 'net/server'),
          N('db', 'net/server'),
          N('ap', 'net/ap'),
          N('guest', 'net/phone'),
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
        ],
      ),
    },
  ],
});
