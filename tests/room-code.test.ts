// tests/room-code.test.ts
// 房间码工具纯函数测试：
// - extractRoomCodeFromText：从剪贴板/分享文案中提取房间码
// - isValidRoomCode / normalizeRoomCode：格式边界

import {
  normalizeRoomCode,
  isValidRoomCode,
  extractRoomCodeFromText,
} from '../utils/room-code';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---- 1. extractRoomCodeFromText：纯房间码整串匹配 ----
{
  assert(extractRoomCodeFromText('7K4M9XQ') === '7K4M9XQ', '纯房间码应整串匹配');
  assert(extractRoomCodeFromText(' 7k4 m9xq ') === '7K4M9XQ', '含空白/小写应归一化后匹配');
}

// ---- 2. 嵌在文案中：窗口扫描提取 ----
{
  assert(extractRoomCodeFromText('房间号：ABC2345，快来加入') === 'ABC2345', '文案中应提取房间码');
  assert(extractRoomCodeFromText('邀请你加入 CoTrip，房间码 9XQK7M4 见') === '9XQK7M4', '句尾房间码可提取');
  assert(extractRoomCodeFromText('abc2345') === 'ABC2345', '混合小写字母应转大写后提取');
}

// ---- 3. 无房间码：返回空串 ----
{
  assert(extractRoomCodeFromText('') === '', '空文本返回空串');
  assert(extractRoomCodeFromText(undefined) === '', 'undefined 返回空串');
  assert(extractRoomCodeFromText('今天天气不错') === '', '纯中文文本返回空串');
  assert(extractRoomCodeFromText('1234567') === '', '非法字符集（含排除字符 1）返回空串');
  assert(extractRoomCodeFromText('abciefg') === '', '非法字符集（含 I/O 等排除字符）返回空串');
  assert(extractRoomCodeFromText('AB23') === '', '长度不足返回空串');
}

// ---- 4. 边界：合法与非法字符集 ----
{
  assert(isValidRoomCode('7K4M9XQ') === true, '合法房间号应通过');
  assert(isValidRoomCode('A2B3C4D') === true, '合法字符集 7 位应通过');
  assert(isValidRoomCode('IO23456') === false, 'I/O 为排除字符应失败');
  assert(isValidRoomCode('ABC23456') === false, '8 位应失败');
  assert(normalizeRoomCode(' ab23 cd4 ') === 'AB23CD4', '归一化去空白转大写');
}

console.log('✅ room-code.test.ts 全部通过');
