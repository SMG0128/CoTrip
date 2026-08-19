// components/conflict-card/index.ts
// 冲突卡片组件：展示 HARD 约束冲突。

import { PlanConflict } from '../../types/plan';

Component({
  properties: {
    conflict: {
      type: Object,
      value: null as PlanConflict | null,
    },
  },
});