// plan-event 通用地点地址展示规则测试。

import { buildPhysicalLocationDisplay } from '../utils/location-display';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`location-display.test failed: ${message}`);
}

const location = {
  name: '广东省博物馆',
  address: '广东省广州市天河区珠江东路2号',
};

const named = buildPhysicalLocationDisplay('参观展览', location);
assert(named.displayName === '广东省博物馆', '标题不含地点名时应显示地点名');
assert(named.address === location.address, 'location.address 有值时应原样显示');

const deduplicated = buildPhysicalLocationDisplay('广东省博物馆参观展览', location);
assert(deduplicated.displayName === '', '标题已含地点名时不应重复显示地点名');
assert(deduplicated.address === location.address, '地点名去重后仍应显示 address');

const restaurant = buildPhysicalLocationDisplay('吃越南菜', {
  name: '真实越南餐厅',
  address: '腾讯返回的餐厅地址',
});
assert(restaurant.displayName === '真实越南餐厅', 'restaurant 名称应使用同一去重规则');
assert(restaurant.address === '腾讯返回的餐厅地址', 'restaurant.address 应显示');

const missing = buildPhysicalLocationDisplay('参观展览', {
  name: '真实展馆',
  address: undefined,
});
assert(missing.displayName === '真实展馆', '无 address 时仍可显示已验证地点名');
assert(missing.address === '', 'address undefined 时地址节点数据应为空');

const blank = buildPhysicalLocationDisplay('参观展览', {
  name: '真实展馆',
  address: '   ',
});
assert(blank.address === '', '空白 address 不应产生地址节点或占位文案');

console.log('location-display.test passed');
