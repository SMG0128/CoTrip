// app.ts
// CoTrip 全局入口
import { authService } from './services/index';

App<IAppOption>({
  globalData: {
    // 当前登录用户（启动时从本地登录态恢复）
    currentUser: null,
  },
  onLaunch() {
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