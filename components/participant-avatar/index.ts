// components/participant-avatar/index.ts
// 参与者头像组件：无头像时显示昵称首字。

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
    initial: '',
  },
  observers: {
    nickname(nickname: string) {
      this.setData({ initial: (nickname || '?').slice(0, 1) });
    },
  },
});