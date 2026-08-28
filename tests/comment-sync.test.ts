// 评论流同步纯函数测试：乐观提交替换、服务端合并、重新进入恢复、并发追加。
// 对应修复验收：POST 后不整体覆盖、GET 服务端为准、按 id 去重。

import { Comment } from '../types/comment';
import {
  commitServerComment,
  createTempCommentId,
  isTempCommentId,
  mergeServerComments,
} from '../utils/comment-sync';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function make(
  id: string,
  rawText: string,
  createdAt: string,
  aiStatus: Comment['aiStatus'] = 'unresolved'
): Comment {
  return { id, tripId: 'trip_T', userId: 'usr_A', rawText, createdAt, aiStatus };
}

export async function runCommentSyncTests(): Promise<void> {
  // 1. 乐观 temp 项被服务端确认评论替换（按 id 合并，不整体覆盖）
  {
    const tempId = createTempCommentId();
    const local = [
      make('comment_1', 'A1', '2026-08-28T10:00:00.000Z'),
      make(tempId, 'B1', '2026-08-28T10:01:00.000Z', 'processing'),
    ];
    const server = make('comment_2', 'B1', '2026-08-28T10:01:00.000Z');
    const merged = commitServerComment(local, server);
    assert(!merged.some((c) => isTempCommentId(c.id)), '临时项必须被服务端评论替换');
    assert(
      merged.some((c) => c.id === 'comment_2' && c.rawText === 'B1'),
      '服务端确认评论已就位'
    );
    assert(merged.some((c) => c.id === 'comment_1'), '其他评论不受影响');
  }

  // 2. 无待确认项时按 id 追加且不产生重复
  {
    const local = [make('comment_1', 'A1', '2026-08-28T10:00:00.000Z')];
    const same = commitServerComment(local, make('comment_1', 'A1', '2026-08-28T10:00:00.000Z'));
    assert(same.length === 1, '同 id 评论不重复追加');
    const appended = commitServerComment(
      local,
      make('comment_2', 'B1', '2026-08-28T10:01:00.000Z')
    );
    assert(appended.length === 2, '新评论追加');
  }

  // 3. 重新进入页面：以服务端列表为准合并（不退不丢、temp 被服务端同内容顶替）
  {
    const tempId = createTempCommentId();
    const local = [
      make('comment_1', 'A1', '2026-08-28T10:00:00.000Z'),
      make(tempId, 'B1', '2026-08-28T10:01:00.000Z', 'processing'),
    ];
    const server = [
      make('comment_1', 'A1', '2026-08-28T10:00:00.000Z'),
      make('comment_2', 'B1', '2026-08-28T10:01:00.000Z'),
    ];
    const merged = mergeServerComments(local, server);
    assert(merged.length === 2, '重新进入后评论流完整（A1 + B1）');
    assert(!merged.some((c) => isTempCommentId(c.id)), '临时项被服务端同内容评论顶替');
    assert(merged.map((c) => c.rawText).join(',') === 'A1,B1', '顺序保持 [A1, B1]');
  }

  // 4. 按 id 去重且服务端覆盖本地同 id 状态
  {
    const local = [make('comment_1', 'A1', '2026-08-28T10:00:00.000Z', 'processing')];
    const server = [make('comment_1', 'A1', '2026-08-28T10:00:00.000Z')];
    const merged = mergeServerComments(local, server);
    assert(merged.length === 1, '同 id 不重复');
    assert(merged[0].aiStatus === 'unresolved', '服务端状态覆盖本地临时状态');
  }

  // 5. 并发乐观提交（乱序确认）不丢数据，按 createdAt 稳定排序
  {
    const temp1 = createTempCommentId();
    const temp2 = createTempCommentId();
    const local = [
      make('comment_0', 'A1', '2026-08-28T10:00:00.000Z'),
      make(temp1, 'A2', '2026-08-28T10:01:00.000Z', 'processing'),
      make(temp2, 'B2', '2026-08-28T10:02:00.000Z', 'processing'),
    ];
    // 乱序确认：B2 先返回，A2 后返回
    const afterB2 = commitServerComment(
      local,
      make('comment_3', 'B2', '2026-08-28T10:02:00.000Z')
    );
    const afterA2 = commitServerComment(
      afterB2,
      make('comment_4', 'A2', '2026-08-28T10:01:00.000Z')
    );
    assert(afterA2.length === 3, '并发追加不丢任何一条');
    assert(afterA2.map((c) => c.rawText).join(',') === 'A1,A2,B2', '按 createdAt 稳定排序');
  }

  console.log('✅ comment-sync.test.ts 全部通过');
}
