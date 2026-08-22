// components/route-options/index.ts
// 路线方案选择器组件：Native Route Picker 语义的单一容器手风琴——
// 最多 3 条 route，三条同级，均为 compact selectable row；
// 同一时刻最多一条展开、允许全部收起（expandedIndex 可为 null）。
// 纯展示层：数据全部由页面注入（options / expandedIndex / loading / errorText），
// 组件只对外发事件（toggle / navigate / retry），绝不自行请求或伪造路线数据。
// 视图模型统一由 utils/route-options-ui.ts 纯函数构建（可单测）：
// - rows：行级（标签/文本语义链/总时长/总价）——Route Row 为一级结构
// - expandedDetail：展开区 = Travel Legs 纵向堆叠 + 统一目的地脚注，不重复行级摘要

import { RouteOption } from '../../types/route-option';
import { tencentMapConfig } from '../../config/tencent-map';
import {
  RouteDetailView,
  RouteRowView,
  buildRouteDetailVM,
  buildRouteRowVMs,
} from '../../utils/route-options-ui';

Component({
  properties: {
    /** 路线方案列表（服务层保证 1..3 条） */
    options: {
      type: Array,
      value: [] as RouteOption[],
    },
    /** 当前展开项索引（number | null：null = 全部收起） */
    expandedIndex: {
      type: Number,
      optionalTypes: [null],
      value: 0,
    },
    /** 规划中：面板内灰色骨架行 */
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
    rows: [] as RouteRowView[],
    expandedDetail: null as RouteDetailView | null,
  },

  observers: {
    // options ≤ 3 条，展开切换时整体重建视图模型的开销可忽略
    'options, expandedIndex'(options: RouteOption[], expandedIndex: number | null) {
      const current =
        expandedIndex !== null && expandedIndex >= 0 ? options[expandedIndex] : undefined;
      this.setData({
        // CoTrip 当前路线请求以 Tencent Map defaultCity=广州市为城市上下文；
        // 只在这个显式上下文中启用广州地铁本地展示色。
        rows: buildRouteRowVMs(options, { city: tencentMapConfig.defaultCity }),
        expandedDetail: current
          ? buildRouteDetailVM(current, undefined, { city: tencentMapConfig.defaultCity })
          : null,
      });
    },
  },

  methods: {
    /** 点击行（摘要区整体可点）：通知页面切换展开索引（收起/切换状态机在 utils/route-options-ui.ts） */
    onCardTap(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);
      if (!Number.isInteger(index)) return;
      this.triggerEvent('toggle', { index });
    },

    /** 去导航：回传原始 RouteOption，坐标解析（最后带坐标 step / resolvedDestination）由页面负责。
     *  使用 catch:tap 阻止冒泡，点击导航不会触发行展开/收起。 */
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
