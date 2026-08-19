// components/constraint-status/index.ts
// AI 状态标签组件：展示评论/约束的处理状态。

import { AIStatus } from '../../types/comment';

const STATUS_MAP: Record<AIStatus, { label: string; color: string; bg: string }> = {
  accepted: { label: '已纳入计划', color: '#1a9e5c', bg: '#e6f7ef' },
  processing: { label: '正在处理', color: '#2f6bff', bg: '#eef2ff' },
  conflict: { label: '存在冲突', color: '#e5484d', bg: '#fdecec' },
  unresolved: { label: '暂无法满足', color: '#9aa0a6', bg: '#f2f3f5' },
  waiting_confirm: { label: '等待确认', color: '#d97706', bg: '#fdf3e3' },
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
  },
  observers: {
    status(status: AIStatus) {
      const s = STATUS_MAP[status] ?? STATUS_MAP.processing;
      this.setData({ label: s.label, color: s.color, bg: s.bg });
    },
  },
});