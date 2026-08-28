import { resolveTripDetailOnShowActions } from '../utils/trip-detail-on-show';
import { DEMO_TRIP_ID } from '../utils/demo-trip';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

const routeHidden = resolveTripDetailOnShowActions({
  tripId: 'trip_real',
  showRoute: false,
  routeLoading: false,
  routeBlockReason: '',
  routeNeedsOrigin: false,
});
assert(routeHidden.refreshComments, '真实行程即使路线面板关闭也必须刷新评论');
assert(!routeHidden.loadRouteOptions, '路线面板关闭时不加载路线');

const routeLoading = resolveTripDetailOnShowActions({
  tripId: 'trip_real',
  showRoute: true,
  routeLoading: true,
  routeBlockReason: 'NO_FIRST_LOCATION',
  routeNeedsOrigin: false,
});
assert(routeLoading.refreshComments, 'routeLoading 不能阻断真实评论刷新');
assert(!routeLoading.loadRouteOptions, 'routeLoading 时不重复加载路线');

const demo = resolveTripDetailOnShowActions({
  tripId: DEMO_TRIP_ID,
  showRoute: false,
  routeLoading: false,
  routeBlockReason: '',
  routeNeedsOrigin: false,
});
assert(!demo.refreshComments, 'Demo 评论保持本地隔离');

console.log('✅ trip-detail-on-show.test.ts 全部通过');
