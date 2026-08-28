// pages/trip-create/trip-create.ts
// 新建行程页：区域限定、时间范围、事件简述、创建。
// 区域限定三种方式：
// - 指定行政区域：国内省市区级联选择（picker mode="region"）
// - 指定地点：wx.chooseLocation 打开地图选点
// - 指定范围：wx.getFuzzyLocation 模糊定位，构建周边范围 bounds
// 所有权：新 Trip 的 creatorId / 默认 participant 一律来自当前真实登录用户 currentUser.id，
// 绝不使用 Mock 占位身份（user_A / mockDevCurrentUser）。

import { AreaConstraint } from '../../types/constraint';
import { Location } from '../../types/location';
import { TimeRange } from '../../types/time';
import { tripService } from '../../services/index';
import { requireCurrentUser } from '../../utils/current-user';
import { buildRangeBounds } from '../../utils/area-range';
import { buildRegionColumns, resolveRegionIndices, regionDisplayText } from '../../utils/china-region';

type AreaMode = 'none' | 'district' | 'location' | 'range';

const AREA_MODE_LABELS: Record<AreaMode, string> = {
  none: '不限区域',
  district: '指定行政区域',
  location: '指定地点',
  range: '指定范围',
};

// 模糊定位精度约 1 公里，3 公里半径可稳定覆盖周边范围
const RANGE_RADIUS_KM = 3;

Page({
  data: {
    areaMode: 'none' as AreaMode,
    areaModeText: AREA_MODE_LABELS.none,
    regionColumns: buildRegionColumns(0, 0),
    regionValue: [0, 0, 0],
    regionText: '',
    locationText: '',
    rangeText: '',
    areaConstraint: { unrestricted: true } as AreaConstraint,
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    brief: '',
  },

  /** 选择区域限定方式；选后由二级行完成具体取值 */
  onAreaTap() {
    wx.showActionSheet({
      itemList: ['不限区域', '指定行政区域', '指定地点', '指定范围'],
      success: (res) => {
        const modes: AreaMode[] = ['none', 'district', 'location', 'range'];
        const mode = modes[res.tapIndex];
        this.setData({
          areaMode: mode,
          areaModeText: AREA_MODE_LABELS[mode],
          // 切换方式后重置具体值，避免残留上一种方式的选择
          regionColumns: buildRegionColumns(0, 0),
          regionValue: [0, 0, 0],
          regionText: '',
          locationText: '',
          rangeText: '',
          areaConstraint: mode === 'none' ? { unrestricted: true } : {},
        });
      },
    });
  },

  /** 指定行政区域：国内省市区三列联动，区列首位为「不限」 */
  onRegionColumnChange(e: WechatMiniprogram.PickerColumnChange) {
    const { column, value: index } = e.detail;
    const [provinceIndex, cityIndex] = this.data.regionValue;
    if (column === 0) {
      // 换省：市、区两列重置
      this.setData({ regionColumns: buildRegionColumns(index, 0), regionValue: [index, 0, 0] });
    } else if (column === 1) {
      // 换市：区列重置
      this.setData({
        regionColumns: buildRegionColumns(provinceIndex, index),
        regionValue: [provinceIndex, index, 0],
      });
    } else {
      this.setData({ regionValue: [provinceIndex, cityIndex, index] });
    }
  },

  onRegionChange(e: WechatMiniprogram.PickerChange) {
    const region = resolveRegionIndices(e.detail.value as number[]);
    if (!region) return;
    // 区不限（索引 0）时仅落到市级约束
    const constraint: AreaConstraint = region.district
      ? { city: region.city, district: region.district }
      : { city: region.city };
    this.setData({ regionText: regionDisplayText(region), areaConstraint: constraint });
  },

  /** 指定地点：打开微信地图选点 */
  onChooseLocationTap() {
    wx.chooseLocation({
      success: (res) => {
        const name = res.name || res.address || '指定地点';
        const location: Location = {
          // 微信选点不返回外部地点 ID，用坐标生成稳定记录 ID（仅用户选择结果，非 Provider 事实）
          id: `wx_poi_${res.longitude.toFixed(6)}_${res.latitude.toFixed(6)}`,
          name,
          latitude: res.latitude,
          longitude: res.longitude,
          address: res.address || '',
        };
        this.setData({ locationText: name, areaConstraint: { location } });
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '打开地图失败，请检查定位授权', icon: 'none' });
      },
    });
  },

  /** 指定范围：模糊定位当前位置，构建周边范围 */
  onRangeTap() {
    wx.getFuzzyLocation({
      type: 'gcj02',
      success: (res) => {
        this.setData({
          rangeText: `当前位置周边约 ${RANGE_RADIUS_KM} 公里`,
          areaConstraint: {
            mapBounds: buildRangeBounds(res.latitude, res.longitude, RANGE_RADIUS_KM),
          },
        });
      },
      fail: () => {
        wx.showToast({ title: '定位失败，请检查定位授权', icon: 'none' });
      },
    });
  },

  /** 区域方式已选但具体值未完成时显式阻断，不静默降级为不限区域 */
  isAreaConstraintFilled(constraint: AreaConstraint): boolean {
    return Boolean(
      constraint.unrestricted ||
        constraint.district ||
        constraint.city ||
        constraint.location ||
        constraint.mapBounds,
    );
  },

  onStartDateChange(e: WechatMiniprogram.Input) {
    this.setData({ startDate: e.detail.value });
  },
  onStartTimeChange(e: WechatMiniprogram.Input) {
    this.setData({ startTime: e.detail.value });
  },
  onEndDateChange(e: WechatMiniprogram.Input) {
    this.setData({ endDate: e.detail.value });
  },
  onEndTimeChange(e: WechatMiniprogram.Input) {
    this.setData({ endTime: e.detail.value });
  },

  onBriefInput(e: WechatMiniprogram.Input) {
    this.setData({ brief: e.detail.value });
  },

  onCreate() {
    const { startDate, startTime, endDate, endTime, brief, areaConstraint } = this.data;

    if (!this.isAreaConstraintFilled(areaConstraint)) {
      wx.showToast({ title: '请先完成区域选择', icon: 'none' });
      return;
    }

    const timeRange: TimeRange | undefined =
      startDate && startTime
        ? {
            start: `${startDate}T${startTime}:00+08:00`,
            end: endDate && endTime ? `${endDate}T${endTime}:00+08:00` : undefined,
            timezone: 'Asia/Shanghai',
          }
        : undefined;

    // 登录守卫：NO AUTH → NO REAL USER OWNERSHIP ACTION
    // 无 currentUser 时禁止创建，绝不回退到 user_A / mockDevCurrentUser。
    const app = getApp<IAppOption>();
    const guard = requireCurrentUser(app.globalData.currentUser);
    if (!guard.ok) {
      wx.showToast({ title: '登录状态失效，请先登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    // 真实创建：creatorId = currentUser.id，默认 participant = [currentUser.id]
    // 新 Trip 天然属于真实用户，无需任何 Mock 身份或 runtime hydration。
    const title = brief.trim() ? brief.trim() : '新行程';
    tripService
      .createTrip({
        title,
        creatorId: guard.user.id,
        initialBrief: brief.trim(),
        areaConstraint,
        timeRange,
      })
      .then((trip) => {
        wx.showToast({ title: '行程已创建', icon: 'success' });
        setTimeout(() => {
          // V0.3：创建页被详情页替换，返回时直达 Home，不再回到「创建行程」页。
          wx.redirectTo({
            url: `/pages/trip-detail/trip-detail?tripId=${encodeURIComponent(trip.id)}`,
          });
        }, 500);
      })
      .catch(() => {
        wx.showToast({ title: '行程创建失败，请稍后重试', icon: 'none' });
      });
  },
});
