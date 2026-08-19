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
    fallbackUrl: '/assets/3d/boy.png',
  },
  observers: {
    nickname(nickname: string) {
      const fallbackUrl = nickname.includes('C') ? '/assets/3d/girl.png' : '/assets/3d/boy.png';
      this.setData({ initial: (nickname || '?').slice(0, 1), fallbackUrl });
    },
  },
});
