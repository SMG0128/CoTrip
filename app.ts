// app.ts
// CoTrip 全局入口
App<IAppOption>({
  globalData: {
    // 当前登录用户（Mock）
    currentUser: null,
  },
  onLaunch() {
    // 预留：后续在此初始化登录态
  },
});