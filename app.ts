// app.ts
// CoTrip 全局入口
import { authService } from './services/index';
import { getPendingJoinRoomCode } from './utils/pending-join';

App<IAppOption>({
  globalData: {
    // 当前登录用户（启动时从本地登录态恢复）
    currentUser: null,
    // 邀请上下文同时保存在 globalData 与本地存储，支持冷启动恢复
    pendingJoinRoomCode: null,
  },
  onLaunch() {
    this.globalData.pendingJoinRoomCode = getPendingJoinRoomCode();
    // 启动时尝试恢复登录态；未登录时保持 null，由登录页引导
    authService.restoreSession().then((session) => {
      if (session) {
        this.globalData.currentUser = session.user;
      }
    }).catch(() => {
      // 恢复失败不阻塞启动，登录页会重新引导
    });
  },
});
