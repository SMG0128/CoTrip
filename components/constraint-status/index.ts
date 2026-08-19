// components/constraint-status/index.ts
// AI 状态标签组件：展示评论/约束的处理状态。

import { AIStatus } from '../../types/comment';

const STATUS_MAP: Record<AIStatus, { label: string; color: string; bg: string; icon: string }> = {
  accepted: { label: '已纳入计划', color: '#12a874', bg: '#e5f9f1', icon: '/assets/icons/status/check.svg' },
  processing: { label: '正在处理', color: '#326bff', bg: '#eaf0ff', icon: '/assets/icons/status/processing.svg' },
  conflict: { label: '存在冲突', color: '#d95665', bg: '#ffedf0', icon: '/assets/icons/status/warning.svg' },
  unresolved: { label: '暂无法满足', color: '#7f8da8', bg: '#f0f2f6', icon: '/assets/icons/status/question.svg' },
  waiting_confirm: { label: '等待确认', color: '#c27b00', bg: '#fff3db', icon: '/assets/icons/status/clock.svg' },
};

Component({
  properties: {
    status: {
      type: String,
      value: 'processing',
    },
  },
  data: {
    label: '',
    color: '',
    bg: '',
    icon: '',
  },
  observers: {
    status(status: AIStatus) {
      const s = STATUS_MAP[status] ?? STATUS_MAP.processing;
      this.setData({ label: s.label, color: s.color, bg: s.bg, icon: s.icon });
    },
  },
});
