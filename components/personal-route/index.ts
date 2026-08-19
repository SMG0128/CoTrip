// components/personal-route/index.ts
// 个人路线组件：展示个人出发建议与路线分段。

import { Route } from '../../types/route';

Component({
  properties: {
    route: {
      type: Object,
      value: null as Route | null,
    },
    segments: {
      type: Array,
      value: [] as Array<{ label: string; action: string; transport: string }>,
    },
  },
  data: {
    departureText: '',
    arrivalText: '',
  },
  observers: {
    route(route: Route | null) {
      if (!route) return;
      const departure = route.departureTime ? route.departureTime.slice(11, 16) : '';
      const arrival = route.arrivalTime ? route.arrivalTime.slice(11, 16) : '';
      this.setData({ departureText: departure, arrivalText: arrival });
    },
  },
});