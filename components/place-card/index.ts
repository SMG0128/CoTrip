// components/place-card/index.ts
// 地点卡片组件。

import { Location } from '../../types/location';

Component({
  properties: {
    location: {
      type: Object,
      value: null as Location | null,
    },
    subtitle: {
      type: String,
      value: '',
    },
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { location: this.data.location });
    },
  },
});