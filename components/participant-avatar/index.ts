// components/participant-avatar/index.ts
// 参与者头像组件：真实头像原样展示；空值 / legacy 占位回退到新默认 SVG；
// 加载失败同样回退默认，绝不显示破图。头像与昵称解耦（不再按昵称猜测占位图）。

import { DEFAULT_AVATAR_SRC, resolveAvatar } from '../../utils/avatar';

Component({
  properties: {
    nickname: {
      type: String,
      value: '',
    },
    avatarUrl: {
      type: String,
      value: '',
    },
    size: {
      type: Number,
      value: 64,
    },
  },
  data: {
    initial: '?',
    displaySrc: DEFAULT_AVATAR_SRC,
  },
  observers: {
    nickname(nickname: string) {
      this.setData({ initial: (nickname || '?').slice(0, 1) });
    },
    avatarUrl(avatarUrl: string) {
      this.setData({ displaySrc: resolveAvatar(avatarUrl) });
    },
  },
  methods: {
    /** 真实头像加载失败时回退默认 SVG，不重试不报错 */
    onImgError() {
      if (this.data.displaySrc !== DEFAULT_AVATAR_SRC) {
        this.setData({ displaySrc: DEFAULT_AVATAR_SRC });
      }
    },
  },
});
