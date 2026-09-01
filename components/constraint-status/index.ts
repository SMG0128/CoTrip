// components/constraint-status/index.ts
// AI 状态标签组件：展示评论/约束的处理状态。

import { AIStatus } from '../../types/comment';

interface StatusVisual {
  label: string;
  color: string;
  bg: string;
  border: string;
  shadow: string;
  icon: string;
}

const STATUS_MAP: Record<AIStatus, StatusVisual> = {
  accepted: {
    label: '已纳入计划',
    color: '#0c9f6d',
    bg: '#e5f9f1',
    border: '#a8e8d2',
    shadow: '0 0 0 1rpx rgba(168, 232, 210, 0.5), 0 0 16rpx rgba(18, 168, 116, 0.16), 0 8rpx 18rpx rgba(18, 168, 116, 0.12)',
    icon: '/assets/icons/status/check.svg',
  },
  processing: {
    label: '正在处理',
    color: '#326bff',
    bg: '#eaf0ff',
    border: '#aec3ff',
    shadow: '0 0 0 1rpx rgba(174, 195, 255, 0.5), 0 0 16rpx rgba(50, 107, 255, 0.16), 0 8rpx 18rpx rgba(50, 107, 255, 0.12)',
    icon: '/assets/icons/status/processing.svg',
  },
  partially_incorporated: {
    label: '部分纳入',
    color: '#326bff',
    bg: '#eaf0ff',
    border: '#aec3ff',
    shadow: '0 0 0 1rpx rgba(174, 195, 255, 0.5), 0 0 16rpx rgba(50, 107, 255, 0.16), 0 8rpx 18rpx rgba(50, 107, 255, 0.12)',
    icon: '/assets/icons/status/clock.svg',
  },
  conflict: {
    label: '存在冲突',
    color: '#d95665',
    bg: '#ffedf0',
    border: '#f3b9c1',
    shadow: '0 0 0 1rpx rgba(243, 185, 193, 0.5), 0 0 16rpx rgba(217, 86, 101, 0.16), 0 8rpx 18rpx rgba(217, 86, 101, 0.12)',
    icon: '/assets/icons/status/warning.svg',
  },
  unresolved: {
    label: '未解析',
    color: '#71809c',
    bg: '#f0f2f6',
    border: '#d8dee8',
    shadow: '0 0 0 1rpx rgba(216, 222, 232, 0.58), 0 0 16rpx rgba(113, 128, 156, 0.14), 0 8rpx 18rpx rgba(113, 128, 156, 0.1)',
    icon: '/assets/icons/status/question.svg',
  },
  waiting_confirm: {
    label: '等待确认',
    color: '#b77000',
    bg: '#fff3db',
    border: '#f1d296',
    shadow: '0 0 0 1rpx rgba(241, 210, 150, 0.52), 0 0 16rpx rgba(194, 123, 0, 0.14), 0 8rpx 18rpx rgba(194, 123, 0, 0.1)',
    icon: '/assets/icons/status/clock.svg',
  },
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
    border: '',
    shadow: '',
    icon: '',
  },
  observers: {
    status(status: AIStatus) {
      const s = STATUS_MAP[status] ?? STATUS_MAP.processing;
      this.setData({
        label: s.label,
        color: s.color,
        bg: s.bg,
        border: s.border,
        shadow: s.shadow,
        icon: s.icon,
      });
    },
  },
});
