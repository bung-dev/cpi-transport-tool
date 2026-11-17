import type { DashboardEdge, DashboardNode } from '../../api/types';

/** 시작 노드부터 위상 정렬한다. 순환 경로도 각 노드를 한 번씩만 표시한다. */
export function orderLandscape(nodes: DashboardNode[], edges: DashboardEdge[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const edge of edges) {
    if (!byId.has(edge.sourceTenantId) || !byId.has(edge.targetTenantId)) continue;
    const targets = outgoing.get(edge.sourceTenantId) ?? [];
    outgoing.set(edge.sourceTenantId, [...targets, edge.targetTenantId]);
    if (!incoming.has(edge.sourceTenantId)) incoming.set(edge.sourceTenantId, 0);
    incoming.set(edge.targetTenantId, (incoming.get(edge.targetTenantId) ?? 0) + 1);
  }
  const ready = [...incoming.keys()].filter(id => incoming.get(id) === 0);
  const visited = new Set<string>();
  const flow: DashboardNode[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    flow.push(byId.get(id)!);
    for (const target of outgoing.get(id) ?? []) {
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
  };
  for (let i = 0; i < ready.length; i += 1) visit(ready[i]);
  // 순환에는 시작점이 없으므로 남은 첫 노드부터 이어서 배치한다.
  for (const id of incoming.keys()) {
    if (visited.has(id)) continue;
    const start = ready.length;
    ready.push(id);
    for (let i = start; i < ready.length; i += 1) visit(ready[i]);
  }
  return { flow, loose: nodes.filter(node => !incoming.has(node.id)) };
}
