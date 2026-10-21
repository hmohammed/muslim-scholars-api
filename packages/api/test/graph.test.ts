import { describe, expect, it } from 'vitest';
import { teacherChains, type GraphNode, type ScholarGraph } from '../src/graph.ts';

function node(id: number, category: string, teachers: number[] = []): GraphNode {
  return { id, nameEn: `Scholar ${id}`, nameAr: null, category, teachers, students: [] };
}

describe('teacher chains', () => {
  it('returns every shortest path from the start through teachers to the goal', () => {
    const graph: ScholarGraph = { nodes: new Map([
      [1, node(1, 'century_3', [2, 3])],
      [2, node(2, 'follower', [4])],
      [3, node(3, 'follower', [4])],
      [4, node(4, 'companion')],
    ]) };
    expect(teacherChains(graph, 1, { kind: 'category', category: 'companion' }, 16)).toEqual([
      [1, 2, 4],
      [1, 3, 4],
    ]);
  });

  it('finds a companion at the end of a long chain in a 25,000-node graph in under 50 ms', () => {
    const nodes = new Map<number, GraphNode>();
    for (let id = 1; id <= 25_000; id++) {
      nodes.set(id, node(id, id === 16 ? 'companion' : 'century_3', id < 25_000 ? [id + 1] : []));
    }
    const started = performance.now();
    const paths = teacherChains({ nodes }, 1, { kind: 'category', category: 'companion' }, 16);
    expect(performance.now() - started).toBeLessThan(50);
    expect(paths).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]]);
  });
});
