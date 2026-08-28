# Changelog

本项目所有显著变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循语义化版本。

## [Unreleased]

### Added
- 房间号真实加入闭环：后端新增 `GET /trips/join-preview`（公开、仅返回安全字段）与 `POST /trips/join`（Bearer 认证、身份仅取服务端校验的 userId、ACTIVE-only、重复加入幂等、creator 不变、participantIds 去重并持久化）
- 前端 Join 流程接通真实 API：Join 落地页加载真实 Preview，`RealTripService` 直连 Join contract 且无 Mock 回退；未登录加入意图持久化（`pendingJoinRoomCode`），登录成功后自动恢复，加入成功后清理 pending state
- 新建行程页图标统一为蓝紫渐变 SVG 风格（`assets/icons/trip-create/`）
- 导航式路线方案选择器：「我的推荐」最多展示 3 条方案，首条默认推荐并展开，任意时刻最多展开 1 条
- 腾讯位置服务路线规划集成（WebService Direction API：transit + walking 并行请求，防御式 DTO 映射）
- 目的地 POI 解析与 `wx.openLocation` 导航 handoff
- 路线加载骨架屏、失败态与重试入口；定位权限感知的错误文案映射
- 广州地铁 compact line badge 本地展示 registry（编号线路仅显示数字、APM 显示「APM」、广佛线显示「广佛」，本地维护线路色，无网络依赖）
- 公交徽章：Provider 真实线路名 + 蓝底白字，不伪造线路
- 票价兜底：route 级票价缺失时以线路级票价多程汇总；未知价格直接隐藏
- Trip 完成闭环：`POST /trips/:id/complete`（仅 creator、幂等、非法状态迁移 409），前端二次确认 + 防重复提交
- 首页「历史行程」线性图标与状态胶囊圆环等轻量视觉元素

### Changed
- Route Picker 三行结构统一（Route 1/2/3 同级，推荐仅为第 1 条徽章）；手风琴支持全部收起（默认展开首条）
- 折叠摘要重构为按真实 leg 顺序的分段链（compact route summary）；展开区为逐腿 Travel Legs 详情
- 行程详情推荐区由静态 Mock 路线重构为 provider 驱动的单展开路线选择器（`RouteOption` ViewModel 隔离第三方响应结构）
- 「邀请好友 / 我的推荐」改为 Segmented Control 分段控件，选中态以白色悬浮卡表达
- 首页配色体系调整为白卡 + 局部氛围（Hero 柔和过渡、渐变描边、图标光晕），保持轻盈质感
- 真实行程路线规划启用：`services/index.ts` 的 `routeOptionService` 切换为 `RealRouteOptionService`（腾讯 direction v1）；「我的推荐」门禁仅要求计划首地点已就绪，出发地点改由面板内显式选择（不自动调用），未配置 Key 时明确显示「暂未配置地图服务」，绝不伪造路线
- 示例行程与真实行程流程一致：首地点（内置示例含第一个地点）就绪后先展示「请选择出发地点」面板，选定后走 `demoRouteOptionService` 读取固化广州 fixture（不消费 query、永不触达腾讯 API，代码内注释标注）
- 路线门禁规则调整：「我的推荐」仅要求计划第一个地点已就绪即可开放；出发地点不再是硬前提，面板初开为「请选择出发地点」两个按钮（使用保存地点 / 地图选点），用户显式选点后才发起规划
- 「地图选点」选中的出发点自动保存为默认出发地点（供下次「使用保存地点」一键复用）；从未保存过出发点时「使用保存地点」按钮引导去「出发设置」

### Fixed
- 修复真实行程缺出发地点时「先去设置、回来才见停用提示」的无效往返：门禁通过后直接发请求，从出发设置返回自动重算路线
- 修复路线推算时刻在中国时区的显示偏差（UTC 结果统一换算东八区展示）
- 修复腾讯 transit 响应解析未对齐现行 API 结构（`steps[].mode` + `lines[]`）导致公交方案无法映射的问题
