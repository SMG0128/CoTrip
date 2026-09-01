// utils/location-display.ts
// 真实物理地点的统一前端展示规则：名称按标题去重，address 缺失时隐藏地址行。

import { Location } from '../types/location';

export interface PhysicalLocationDisplay {
  displayName: string;
  address: string;
}

function nonEmpty(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildPhysicalLocationDisplay(
  eventTitle: string | undefined,
  location: Pick<Location, 'name' | 'address'> | null | undefined,
): PhysicalLocationDisplay {
  if (!location) return { displayName: '', address: '' };
  const title = nonEmpty(eventTitle);
  const name = nonEmpty(location.name);
  return {
    displayName: name && title.includes(name) ? '' : name,
    // address 是 factual field：不以 district、名称或占位文案代替。
    address: nonEmpty(location.address),
  };
}
