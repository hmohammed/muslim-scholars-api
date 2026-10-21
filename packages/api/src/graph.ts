import type { Kysely } from 'kysely';
import type { Database } from '@msapi/db';

export interface GraphNode {
  id: number;
  nameEn: string;
  nameAr: string | null;
  category: string;
  teachers: number[];
  students: number[];
}

export interface ScholarGraph {
  nodes: Map<number, GraphNode>;
}

export async function loadGraph(db: Kysely<Database>): Promise<ScholarGraph> {
  const people = await db.selectFrom('scholar').select(['id', 'name_en', 'name_ar', 'category']).execute();
  const edges = await db.selectFrom('teaching_edge').select(['teacher_id', 'student_id']).execute();
  const nodes = new Map<number, GraphNode>();
  for (const person of people) {
    nodes.set(person.id, {
      id: person.id,
      nameEn: person.name_en,
      nameAr: person.name_ar,
      category: person.category,
      teachers: [],
      students: [],
    });
  }
  for (const edge of edges) {
    const teacher = nodes.get(edge.teacher_id);
    const student = nodes.get(edge.student_id);
    if (!teacher || !student || teacher.id === student.id) continue;
    teacher.students.push(student.id);
    student.teachers.push(teacher.id);
  }
  return { nodes };
}

export type ChainGoal = { kind: 'id'; id: number } | { kind: 'category'; category: string };

/** Shortest teacher-chains. Paths run from `fromId` through teachers toward the goal. */
export function teacherChains(graph: ScholarGraph, fromId: number, goal: ChainGoal, maxDepth: number): number[][] {
  if (!graph.nodes.has(fromId)) return [];
  const isGoal = (id: number) => goal.kind === 'id' ? id === goal.id : graph.nodes.get(id)?.category === goal.category;
  if (isGoal(fromId)) return [[fromId]];

  const parents = new Map<number, number[]>();
  const distance = new Map<number, number>([[fromId, 0]]);
  let frontier = [fromId];
  let foundAt: number | null = null;

  for (let depth = 0; depth < maxDepth && frontier.length > 0 && foundAt === null; depth++) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const teacherId of graph.nodes.get(id)?.teachers ?? []) {
        const step = depth + 1;
        const known = distance.get(teacherId);
        if (known === undefined) {
          distance.set(teacherId, step);
          parents.set(teacherId, [id]);
          next.push(teacherId);
          if (isGoal(teacherId)) foundAt = step;
        } else if (known === step) {
          parents.get(teacherId)?.push(id);
        }
      }
    }
    frontier = next;
  }
  if (foundAt === null) return [];

  const goals = [...distance.keys()].filter(id => distance.get(id) === foundAt && isGoal(id));
  const paths: number[][] = [];
  const walk = (id: number, acc: number[]) => {
    if (paths.length >= 20) return;
    const chain = [id, ...acc];
    if (id === fromId) {
      paths.push(chain);
      return;
    }
    for (const parent of parents.get(id) ?? []) walk(parent, chain);
  };
  for (const goalId of goals) walk(goalId, []);
  return paths;
}

export function network(graph: ScholarGraph, id: number, depth: number, limit: number): { nodeIds: number[]; edges: { teacher_id: number; student_id: number }[] } {
  const seen = new Set<number>([id]);
  let frontier = [id];
  const edges: { teacher_id: number; student_id: number }[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (teacherId: number, studentId: number) => {
    const key = `${teacherId}:${studentId}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ teacher_id: teacherId, student_id: studentId });
  };
  for (let step = 0; step < depth; step++) {
    const next: number[] = [];
    for (const current of frontier) {
      const node = graph.nodes.get(current);
      if (!node) continue;
      for (const teacherId of node.teachers) {
        addEdge(teacherId, current);
        if (!seen.has(teacherId) && seen.size < limit) {
          seen.add(teacherId);
          next.push(teacherId);
        }
      }
      for (const studentId of node.students) {
        addEdge(current, studentId);
        if (!seen.has(studentId) && seen.size < limit) {
          seen.add(studentId);
          next.push(studentId);
        }
      }
    }
    frontier = next;
  }
  return { nodeIds: [...seen], edges };
}
