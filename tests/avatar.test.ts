// tests/avatar.test.ts
// 微信头像主动选择与默认头像重做测试：
// - 新默认头像为极简线条 SVG；空值 / 旧版 boy/girl 占位统一回退展示
// - 「使用微信头像」取消 / 失败保持原状，不清空已有头像、不阻塞昵称保存
// - 远程 URL / data URI 视为用户真实头像，绝不被误判替换
// - avatar 与 profileCompleted 解耦的语义由服务端测试覆盖（avatar-only 不置位等）

import {
  DEFAULT_AVATAR_SRC,
  applyChosenAvatar,
  isDefaultAvatar,
  resolveAvatar,
} from '../utils/avatar';
import { validateNicknameInput } from '../utils/auth-flow';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

export async function runAvatarTests(): Promise<void> {
  // ---- 1. 新用户默认显示新 SVG：空值一律回退到极简线条默认头像 ----
  // （默认头像资源文件的存在性与内容规范由仓库 assets/icons/avatar/default-avatar.svg 保证）
  {
    assert(resolveAvatar(undefined) === DEFAULT_AVATAR_SRC, '无头像时解析为新默认 SVG');
    assert(resolveAvatar('') === DEFAULT_AVATAR_SRC, '空字符串头像解析为新默认 SVG');
    assert(resolveAvatar('   ') === DEFAULT_AVATAR_SRC, '空白头像解析为新默认 SVG');
  }

  // ---- 2. 不选择微信头像也能完成资料：草稿保持空，提交只需合法昵称 ----
  {
    const untouched = applyChosenAvatar('', null);
    assert(!untouched.changed && untouched.avatarUrl === '', '未选择头像时草稿保持为空');
    const check = validateNicknameInput(' 阿明 ');
    assert(check.ok && check.value === '阿明', '仅凭合法昵称即可通过校验（头像非阻塞项）');
  }

  // ---- 3. 用户主动选择微信头像后，预览正确更新 ----
  {
    const outcome = applyChosenAvatar('', 'wxfile://tmp_abc.jpg');
    assert(outcome.changed, '成功选择产生新预览值');
    assert(outcome.avatarUrl === 'wxfile://tmp_abc.jpg', '预览值即选择的临时路径');
  }

  // ---- 4/5. 保存后持久化与重启恢复由服务端测试覆盖（auth.test.ts 重启用例含 avatarUrl 断言）----

  // ---- 6/7. 取消 / 失败：保持原状态，不清空已有头像，不抛错 ----
  {
    const existing = 'data:image/png;base64,QQ==';
    const cancelled = applyChosenAvatar(existing, undefined);
    assert(!cancelled.changed && cancelled.avatarUrl === existing, '取消选择保留已有头像草稿');
    const failed = applyChosenAvatar(existing, '');
    assert(!failed.changed && failed.avatarUrl === existing, '失败路径保留已有头像草稿');
    const fromDefault = applyChosenAvatar(undefined, null);
    assert(!fromDefault.changed && fromDefault.avatarUrl === '', '从默认态取消仍回到默认态');
  }

  // ---- 8. legacy 旧默认头像（boy/girl 占位图）→ 展示新 SVG ----
  {
    assert(isDefaultAvatar('/assets/3d/boy.png'), '旧 boy.png 占位识别为默认头像');
    assert(isDefaultAvatar('/assets/3d/girl.png'), '旧 girl.png 占位识别为默认头像');
    assert(resolveAvatar('/assets/3d/girl.png') === DEFAULT_AVATAR_SRC, 'legacy 占位展示层回退到新 SVG');
  }

  // ---- 9. 历史真实自定义头像绝不被替换 ----
  {
    assert(!isDefaultAvatar('https://third.party.example/a.png'), '远程 URL 不视为默认头像');
    assert(!isDefaultAvatar('data:image/png;base64,QQ=='), 'data URI 不视为默认头像');
    assert(
      resolveAvatar('https://third.party.example/a.png') === 'https://third.party.example/a.png',
      '远程真实头像原样返回'
    );
    assert(
      resolveAvatar('/uploads/custom-avatar.png') === '/uploads/custom-avatar.png',
      '本地自定义头像路径原样返回'
    );
  }
}
