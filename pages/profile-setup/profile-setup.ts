// pages/profile-setup/profile-setup.ts
// 完善资料页：两种模式。
// - setup（默认）：首次登录后设置昵称，保存后按登录续接语义落地（邀请落地页 / 首页）。
// - edit（?mode=edit）：从「我的」进入修改资料，保存后返回上一页。
// 资料一律经 AuthService.updateProfile 提交真实后端；失败留在本页可重试，绝不伪造成功。
//
// 头像规则：
// - 「使用微信头像」必须由用户主动触发（button open-type=chooseAvatar，合规方式）；
// - 取消 / 失败保持原状：不清空已有头像、不报致命错误、不阻塞昵称保存；
// - 选择成功以 data URI 经现有 avatarUrl 字段持久化（复用 PATCH 链路，无新增后端协议）；
// - 头像绝不参与 profileCompleted 判定。

import { authService } from '../../services/index';
import { ROUTE_HOME, validateNicknameInput } from '../../utils/auth-flow';
import { resolveLoginContinuation } from '../../utils/join-flow';
import { getPendingJoinRoomCode } from '../../utils/pending-join';
import { DEFAULT_AVATAR_SRC, applyChosenAvatar, resolveAvatar } from '../../utils/avatar';

Page({
  data: {
    nickname: '',
    saving: false,
    isEdit: false,
    /** 头像预览源：已选草稿优先，否则解析当前用户真实头像 / 默认 SVG */
    previewSrc: DEFAULT_AVATAR_SRC,
    /** 本轮主动选择的头像草稿（data URI）；'' 表示未修改头像 */
    avatarDraft: '',
  },

  onLoad(options?: Record<string, string | undefined>) {
    const user = getApp<IAppOption>().globalData.currentUser;
    this.setData({
      isEdit: options?.mode === 'edit',
      // 仅编辑模式预填当前昵称；setup 模式保持空白引导用户主动输入
      nickname: options?.mode === 'edit' ? user?.nickname ?? '' : '',
      previewSrc: resolveAvatar(user?.avatarUrl),
    });
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value });
  },

  /** 用户主动选择微信头像；取消 / 失败一律保持现状 */
  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>) {
    const outcome = applyChosenAvatar(this.data.avatarDraft, e.detail?.avatarUrl);
    if (!outcome.changed) return;
    this.convertToPersistentAvatar(outcome.avatarUrl);
  },

  /** 临时文件转 data URI：预览立即更新，保存值与预览一致；失败保留原头像并可重选 */
  convertToPersistentAvatar(tempPath: string) {
    wx.getFileSystemManager().readFile({
      filePath: tempPath,
      encoding: 'base64',
      success: (res) => {
        const dataUri = `data:image/png;base64,${res.data}`;
        this.setData({ avatarDraft: dataUri, previewSrc: dataUri });
      },
      fail: () => {
        wx.showToast({ title: '头像未更新，请重试', icon: 'none' });
      },
    });
  },

  onSubmit() {
    if (this.data.saving) return;
    const check = validateNicknameInput(this.data.nickname);
    if (!check.ok) {
      wx.showToast({ title: check.reason, icon: 'none' });
      return;
    }

    // 昵称必填；头像仅在本轮主动选择过才随 PATCH 提交（不要求用户设置头像）
    const patch: { nickname: string; avatarUrl?: string } = { nickname: check.value };
    if (this.data.avatarDraft) patch.avatarUrl = this.data.avatarDraft;

    this.setData({ saving: true });

    authService
      .updateProfile(patch)
      .then((result) => {
        const app = getApp<IAppOption>();
        app.globalData.currentUser = result.user;

        if (this.data.isEdit) {
          wx.showToast({ title: '已保存', icon: 'success' });
          // 等 toast 展示片刻再返回上一页
          setTimeout(() => wx.navigateBack(), 600);
          return;
        }

        // 首次完善资料后复用登录续接语义：邀请场景回到落地页（仍由用户手动点加入，
        // pending 清理语义不变）；否则进入首页。
        const continuation = resolveLoginContinuation(getPendingJoinRoomCode());
        if (continuation.kind === 'join') {
          wx.redirectTo({ url: continuation.url });
          return;
        }
        wx.switchTab({ url: ROUTE_HOME });
      })
      .catch((err: Error) => {
        // 失败留在本页可重试，绝不导航、绝不静默跳过。
        wx.showToast({
          title: err.message || '保存失败，请重试',
          icon: 'none',
        });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  },
});
