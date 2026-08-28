import { evaluateRealCommentPlan } from '../utils/real-comment-planning';
import { Comment } from '../types/comment';
import { Plan } from '../types/plan';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

const emptyPlan: Plan = {
  id: 'plan_T',
  tripId: 'trip_T',
  version: 0,
  events: [],
  satisfiedConstraintCount: 99,
  totalConstraintCount: 99,
  conflicts: [],
  updatedAt: '2026-08-28T00:00:00.000Z',
};

function accepted(id: string, userId: string, rawText: string, draft: NonNullable<Comment['aiAnalysis']>['constraints'][number]): Comment {
  return {
    id,
    tripId: 'trip_T',
    userId,
    rawText,
    createdAt: '2026-08-28T00:00:00.000Z',
    aiStatus: 'accepted',
    aiSource: 'provider',
    aiAnalysis: {
      intent: draft.type === 'PREFERENCE' ? 'preference' : 'constraint',
      constraints: [draft],
      confidence: 0.9,
      requiresConfirmation: false,
    },
    author: { id: userId, nickname: userId, avatarUrl: '' },
  };
}

const comments = [
  accepted('comment_1', 'usr_A', '羽毛球必须在天河', {
    type: 'LOCATION', scope: 'SPORT', priority: 'HARD', value: { district: '天河区' },
  }),
  accepted('comment_2', 'usr_B', '想吃越南菜', {
    type: 'PREFERENCE', scope: 'DINING', priority: 'SOFT', value: { keyword: 'VIETNAMESE' },
  }),
];

const result = evaluateRealCommentPlan(emptyPlan, comments);
assert(result.constraints.length === 2, '只使用服务端 accepted analysis 形成两个约束');
assert(result.plan.totalConstraintCount === 2, '总需求数为 2');
assert(result.plan.satisfiedConstraintCount === 0, '空计划必须已满足 0 / 2');

const unresolved: Comment = {
  ...comments[0],
  id: 'comment_unresolved',
  rawText: '哈哈哈哈',
  aiStatus: 'unresolved',
  aiSource: 'none',
  aiAnalysis: undefined,
};
const withUnresolved = evaluateRealCommentPlan(emptyPlan, [unresolved]);
assert(withUnresolved.constraints.length === 0, '未解析评论不得形成 Constraint');
assert(withUnresolved.plan.totalConstraintCount === 0, '未解析评论不得错误增加 N');
assert(withUnresolved.plan.satisfiedConstraintCount === 0, '未解析评论不得 accepted/satisfied');

console.log('✅ real-comment-planning.test.ts 全部通过');
