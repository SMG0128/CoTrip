// core/index.ts
// 规划核心统一出口

export { parseComment, parseComments, defaultParseContext } from './constraint-parser';
export type { ParseContext, ParseResult } from './constraint-parser';
export {
  evaluateConstraintAgainstPlan,
  evaluateConstraintsAgainstPlan,
  countSatisfiedConstraints,
} from './constraint-evaluator';
export type { ConstraintSatisfaction, ConstraintEvaluation } from './constraint-evaluator';
export { ConstraintStore } from './constraint-store';
export { detectConflicts } from './conflict-detector';
export type { ConflictDetectionInput } from './conflict-detector';
export { reconcilePlan } from './plan-reconciler';
export type { ReconcileInput } from './plan-reconciler';
export { PlanningEngine } from './planning-engine';
export type { PlanningEngineOptions, PlanningResult } from './planning-engine';
export { rankCandidates } from './candidate-ranker';
export type { RankedCandidate, RankCandidatesInput } from './candidate-ranker';
