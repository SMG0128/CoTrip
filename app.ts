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
    // 启动时尝试恢复登录态；恢复结果同时暴露为 authReady，登录页等待它完成冷启动路由。
    // 未登录或恢复失败时 authReady 解析为 null，登录页据此停留在登录态，绝不伪造会话。
    this.globalData.authReady = authService.restoreSession().then((session) => {
      if (session) { this.globalData.currentUser = session.user; }
      return session;
    }).catch(() => null);
  },
});
