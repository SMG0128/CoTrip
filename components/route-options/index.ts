// components/route-options/index.ts
// 路线方案选择器组件：手风琴式最多 3 条路线方案（折叠摘要卡 + 展开详情时间轴）。
// 纯展示层：数据全部由页面注入（options / expandedIndex / loading / errorText），
// 组件只对外发事件（toggle / navigate / retry），绝不自行请求或伪造路线数据。

import { RouteOption } from '../../types/route-option';
import {
  formatRouteArrivalFooter,
  formatRouteModesLine,
  formatRouteScheduleLine,
  formatRouteStepDesc,
} from '../../utils/route-options-ui';

/** 折叠摘要卡视图模型（wxml 无法调用函数，展示字段统一在此预计算） */
interface RouteOptionSummaryView {
  /** 方案 id，同时作为 wx:key */
  id: string;
  /** 原始数据：navigate 事件原样回传给页面 */
  raw: RouteOption;
  /** 左上标签：第 0 条「推荐」胶囊；其余「路线 N/M」灰字 */
  badgeText: string;
  durationText: string;
  modesLine: string;
  scheduleLine: string;
  summary: string;
}

/** 展开详情时间轴节点视图模型 */
interface RouteStepView {
  key: string;
  title: string;
  subtitle: string;
  descText: string;
  isArrival: boolean;
}

/** 摘要卡标签：第 0 条固定「推荐」，其余「路线 N/M」（N 从 1 起） */
function buildBadgeText(index: number, total: number): string {
  return index === 0 ? '推荐' : `路线 ${index + 1}/${total}`;
}

function buildSummaryViews(options: RouteOption[]): RouteOptionSummaryView[] {
  return options.map((option, index) => ({
    id: option.id,
    raw: option,
    badgeText: buildBadgeText(index, options.length),
    durationText: `${option.durationMinutes} 分钟`,
    modesLine: formatRouteModesLine(option.modes),
    scheduleLine: formatRouteScheduleLine(option),
    summary: option.summary ?? '',
  }));
}

function buildStepViews(option: RouteOption): RouteStepView[] {
  return option.steps.map((step, index) => ({
    key: `step_${index}_${step.title}`,
    title: step.title,
    subtitle: step.subtitle ?? '',
    descText: formatRouteStepDesc(step),
    isArrival: step.type === 'ARRIVAL',
  }));
}

Component({
  properties: {
    /** 路线方案列表（服务层保证 1..3 条） */
    options: {
      type: Array,
      value: [] as RouteOption[],
    },
    /** 当前展开项索引（手风琴单值状态；至少恒有一条展开） */
    expandedIndex: {
      type: Number,
      value: 0,
    },
    /** 规划中：三张灰色 skeleton 摘要卡 */
    loading: {
      type: Boolean,
      value: false,
    },
    /** 错误文案（空串 = 无错误）；非空时显示失败态 + 「重新规划」 */
    errorText: {
      type: String,
      value: '',
    },
  },

  data: {
    summaries: [] as RouteOptionSummaryView[],
    steps: [] as RouteStepView[],
    arrivalText: '',
  },

  observers: {
    // options ≤ 3 条，展开切换时整体重建视图模型的开销可忽略
    'options, expandedIndex'(options: RouteOption[]) {
      const expanded = this.data.expandedIndex as number;
      const current = options[expanded];
      this.setData({
        summaries: buildSummaryViews(options),
        steps: current ? buildStepViews(current) : [],
        arrivalText: current ? formatRouteArrivalFooter(current.arrivalTime) : '',
      });
    },
  },

  methods: {
    /** 点击折叠摘要卡：通知页面切换展开索引（状态机在 utils/route-options-ui.ts） */
    onCardTap(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);
      if (!Number.isInteger(index)) return;
      this.triggerEvent('toggle', { index });
    },

    /** 去导航：回传原始 RouteOption，坐标解析（最后带坐标 step / resolvedDestination）由页面负责 */
    onNavTap(e: WechatMiniprogram.TouchEvent) {
      const option = e.currentTarget.dataset.option as RouteOption | undefined;
      if (!option) return;
      this.triggerEvent('navigate', { option });
    },

    /** 错误态「重新规划」 */
    onRetryTap() {
      this.triggerEvent('retry', {});
    },
  },
});
