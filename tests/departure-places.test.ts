// tests/departure-places.test.ts
// 默认出发地点纯函数测试：
// - buildPlaceId / buildDeparturePlace：坐标 ID 稳定性与名称兜底
// - mergeDeparturePlace：新地点置首、同坐标去重更新、不改原数组
// - removeDeparturePlace / parseStoredPlaces：删除与损坏数据丢弃

import {
  buildDeparturePlace,
  buildPlaceId,
  mergeDeparturePlace,
  parseStoredPlaces,
  removeDeparturePlace,
} from '../utils/departure-places';
import { Location } from '../types/location';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function place(id: string, name: string): Location {
  return { id, name, latitude: 23.1, longitude: 113.2, address: '' };
}

// ---- 1. ID 与构建 ----
{
  assert(buildPlaceId(23.129083, 113.264412) === 'wx_poi_113.264412_23.129083', 'ID 应为经度_纬度格式且 6 位圆整');
  const p = buildDeparturePlace({ name: '', address: '某路 1 号', latitude: 23.1, longitude: 113.2 });
  assert(p.name === '某路 1 号', '名称为空应回退地址');
  const p2 = buildDeparturePlace({ name: '', address: '', latitude: 23.1, longitude: 113.2 });
  assert(p2.name === '出发地点', '名称地址均空应兜底默认名');
  assert(
    buildDeparturePlace({ name: 'A', address: 'x', latitude: 23.1, longitude: 113.2 }).id ===
      buildDeparturePlace({ name: 'B', address: 'y', latitude: 23.1, longitude: 113.2 }).id,
    '同坐标应生成相同 ID（去重依据）',
  );
}

// ---- 2. 合并：置首与去重 ----
{
  const a = place('p_a', '公司');
  const b = place('p_b', '家');
  const list = mergeDeparturePlace([a, b], place('p_c', '健身房'));
  assert(list.length === 3 && list[0].name === '健身房', '新地点应插到首位');
  assert(list[1].name === '公司' && list[2].name === '家', '原有顺序应保持');
  // 同坐标重复添加：更新信息并移到首位，不产生重复
  const updated = mergeDeparturePlace(list, place('p_c', '健身房（新馆）'));
  assert(updated.length === 3, '同坐标重复添加不应产生重复项');
  assert(updated[0].name === '健身房（新馆）', '同坐标重复添加应更新并置首');
  // 纯函数不应修改原数组
  assert(list[0].name === '健身房', '原数组不应被修改');
}

// ---- 3. 删除 ----
{
  const list = [place('p_a', '公司'), place('p_b', '家')];
  const rest = removeDeparturePlace(list, 'p_a');
  assert(rest.length === 1 && rest[0].id === 'p_b', '删除应移除指定项');
  assert(list.length === 2, '原数组不应被修改');
  assert(removeDeparturePlace(list, 'missing').length === 2, '删除不存在 ID 应返回等长列表');
}

// ---- 4. storage 解析：损坏数据安全丢弃 ----
{
  const good = { id: 'p_a', name: '公司', latitude: 23.1, longitude: 113.2, address: '' };
  assert(parseStoredPlaces(null).length === 0, 'null 应返回空列表');
  assert(parseStoredPlaces('junk').length === 0, '字符串应返回空列表');
  assert(parseStoredPlaces([good, null, 'x', { id: 'p_b' }]).length === 1, '缺字段/非对象项应被丢弃');
  assert(parseStoredPlaces([{ ...good, latitude: '23' }]).length === 0, '纬度非数值应被丢弃');
  const parsed = parseStoredPlaces([good]);
  assert(parsed[0].name === '公司' && parsed[0].latitude === 23.1, '合法数据应完整保留');
}

console.log('✅ departure-places.test.ts 全部通过');
