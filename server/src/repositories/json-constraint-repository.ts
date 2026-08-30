// JSON Constraint Ledger 仓库：独立记录 + 原子追加写入。
// 与 JsonCommentRepository 相同的同步 read-modify-write + 原子 rename：
// 并发 create 不丢记录、不覆盖历史。

import fs from 'fs';
import path from 'path';
import { TripConstraint, TripConstraintStatus } from '../types/trip-constraint';
import { ConstraintRepository } from './constraint-repository';
import { AppError } from '../types/errors';

interface Store {
  constraints: TripConstraint[];
}

export class JsonConstraintRepository implements ConstraintRepository {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  create(constraint: TripConstraint): Promise<TripConstraint> {
    const current = this.load();
    const nextStore: Store = { constraints: [...current.constraints, constraint] };
    this.save(nextStore);
    return Promise.resolve(constraint);
  }

  update(constraint: TripConstraint): Promise<TripConstraint> {
    const current = this.load();
    if (!current.constraints.some((candidate) => candidate.id === constraint.id)) {
      throw new AppError(404, 'CONSTRAINT_NOT_FOUND', '约束不存在');
    }
    const nextStore: Store = {
      constraints: current.constraints.map((candidate) =>
        candidate.id === constraint.id ? constraint : candidate
      ),
    };
    this.save(nextStore);
    return Promise.resolve(constraint);
  }

  listByTrip(tripId: string): Promise<TripConstraint[]> {
    const list = this.load().constraints
      .filter((constraint) => constraint.tripId === tripId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return Promise.resolve(list);
  }

  private load(): Store {
    if (!fs.existsSync(this.file)) {
      return { constraints: [] };
    }
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as { constraints?: unknown };
      if (!Array.isArray(parsed.constraints)) {
        throw new Error('invalid constraint store');
      }
      return {
        constraints: (parsed.constraints as Partial<TripConstraint>[]).map(normalizeConstraint),
      };
    } catch {
      throw new AppError(500, 'CONSTRAINT_PERSISTENCE_FAILURE', '约束数据读取失败');
    }
  }

  private save(store: Store): void {
    const directory = path.dirname(this.file);
    const temporaryFile = `${this.file}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), 'utf8');
      fs.renameSync(temporaryFile, this.file);
    } catch {
      try {
        fs.rmSync(temporaryFile, { force: true });
      } catch {
        // 保留原始写入错误
      }
      throw new AppError(500, 'CONSTRAINT_PERSISTENCE_FAILURE', '约束数据保存失败');
    }
  }
}

function normalizeConstraint(constraint: Partial<TripConstraint>): TripConstraint {
  const validTypes: TripConstraint['type'][] = [
    'AVAILABILITY',
    'LOCATION',
    'BUDGET',
    'PREFERENCE',
  ];
  const validScopes: TripConstraint['scope'][] = ['TRIP', 'SPORT', 'DINING', 'TRANSPORT'];
  const validPriorities: TripConstraint['priority'][] = ['HARD', 'SOFT'];
  const validStatuses: TripConstraintStatus[] = ['ACTIVE', 'SUPERSEDED', 'WITHDRAWN'];
  return {
    id: String(constraint.id ?? ''),
    tripId: String(constraint.tripId ?? ''),
    sourceCommentId: String(constraint.sourceCommentId ?? ''),
    userId: String(constraint.userId ?? ''),
    type: validTypes.includes(constraint.type as TripConstraint['type'])
      ? constraint.type as TripConstraint['type']
      : 'PREFERENCE',
    scope: validScopes.includes(constraint.scope as TripConstraint['scope'])
      ? constraint.scope as TripConstraint['scope']
      : 'TRIP',
    priority: validPriorities.includes(constraint.priority as TripConstraint['priority'])
      ? constraint.priority as TripConstraint['priority']
      : 'SOFT',
    value: constraint.value && typeof constraint.value === 'object' ? constraint.value : {},
    status: validStatuses.includes(constraint.status as TripConstraintStatus)
      ? constraint.status as TripConstraintStatus
      : 'ACTIVE',
    ...(constraint.supersedesConstraintId
      ? { supersedesConstraintId: String(constraint.supersedesConstraintId) }
      : {}),
    requiresConfirmation: Boolean(constraint.requiresConfirmation),
    createdAt: String(constraint.createdAt ?? ''),
    updatedAt: String(constraint.updatedAt ?? ''),
  };
}
