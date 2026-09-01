# Changelog

本项目所有显著变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循语义化版本。

## [Unreleased]

### Added
- 行程时间线日期分组展示：按活动 local date（+08:00）生成日期头（如「9月10日 · 周四」），同一天仅首次显示、跨天生成新日期头，日期由活动 ISO 时间推导而非系统当前日期
- 通用地点短语提取（`extractPlaceQuery`）：「广州图书馆看书 / 参观省博物馆 / 去广州塔 / 在天河体育中心打羽毛球」等统一剥离动作词得到地点短语，结合 trip city 走腾讯 POI 解析为真实地点并渲染地址
- 通用餐饮关键词提取（`extractFoodKeyword`）：越南菜 / 泰国菜 / 粤菜 / 火锅 / 咖啡 / 甜品等统一走腾讯 nearby，无菜系 special-case 分支；「吃饭 / 附近吃饭 / 找个餐厅」→「餐厅」
- 评论驱动先后关系解析：「参观省博后吃越南菜」「之后附近吃越南菜」→ 餐饮活动链接到前置活动（`afterActivityId` + `near_previous_activity`），nearby anchor 使用前置活动真实腾讯坐标
- 行程时间线 / 地点详情展示真实腾讯 POI 地址；标题已含地点名时去重展示避免视觉重复
- 全局 resolved physical location contract：Tencent Provider 身份、POI id、名称与合法坐标齐全才视为 resolved；活动地点、餐厅和咖啡馆共用同一事实字段规则
- Tencent 地址补全：POI Search / nearby 未返回 address 但有合法坐标时，复用同一 Provider 的 Reverse Geocoder；腾讯仍无法提供时保持 `undefined`，绝不伪造

### Changed
- 移除真实行程 production runtime 中的本地 mock 餐厅注入：`pages/trip-detail` 真实行程分支不再以 `realRestaurants` 排序生成候选，候选只来自服务端计划中的已验证实体；`place-detail` 支持上游直传实体数据跳转，mock 表仅保留 id 回查 fallback（示例行程 fixture）
- `place-detail` 的「AI 推荐理由」不再注入伪造文案：无真实理由时不显示该卡片
- 餐厅可选字段 truth-preserving：腾讯未返回 rating / avgPrice 时保持 `undefined`，前端按缺省隐藏，绝不补齐伪造事实
- 地址持久化与展示保持 truth-preserving：sanitizer 只保留已验证 Tencent location 的非空 address；活动与餐厅统一展示真实 address，缺失时隐藏地址节点且不以 district 或占位文案替代

### Fixed
- 修复「广州图书馆看书」等非「去X」句型活动无法解析 POI 的问题（原提取器仅匹配「去」前缀）
- 修复 `isMealTitle` 漏判「咖啡 / 火锅 / 甜品」等纯菜系标题导致误当地点解析的问题

### Added
- AI 行程时间确定性解析：行程日期与活动时间锚定到行程日期（+08:00 时区），活动时间不再依赖 AI 自由发挥
- 评论时长解析：从评论提取时长（如「看三个小时」→ 180 分钟）并绑定到语义相关的活动
- 先后关系约束：解析「去完 X 后去 Y」为 `afterActivityId` + `near_previous_activity`，保证活动不重叠
- 腾讯真实 POI 解析：服务端复用项目已有腾讯位置服务（`ws/place/v1/search`），把「广图 / 广州图书馆」解析为真实腾讯 POI，并做附近餐厅搜索；搜索失败绝不回退 mock / hardcoded / AI 生成的餐厅名
- fail-closed 落库 sanitizer：落库前剥离所有未经验证的事实字段，失败时保留 AI 意图文本但绝不写入未验证数据
- 服务端腾讯 Key 仅从 `process.env.TENCENT_MAP_KEY` 读取；未配置时 POI 解析明确返回不可用，不从 frontend config 自动读取 Key

### Changed
- 无真实路线时长时，后续活动 `start = previous.end`（最早不重叠时刻），**绝不凭空生成 travel duration**；真实 route duration 由外部注入复用，不新造第二套路由系统
- 腾讯 POI 字段 truth-preserving：腾讯 API 实际未返回的字段（rating / avgPrice / photo 等）一律保持 `undefined`，绝不补齐伪造

### Fixed
- 移除伪造的 30 分钟 travel duration（原为 hardcoded default，非真实 route provider 数据）
- 移除服务端对 frontend public Tencent Key 的隐式回退：真实 E2E 仅通过显式 env 注入 Key

### Added
- 房间号加入链路：`POST /trips/join-preview`（公开、仅返回安全字段）与 `POST /trips/join`（Bearer 认证、身份仅取服务端校验的 userId、ACTIVE-only、重复加入幂等、creator 不变、participantIds 去重并持久化）
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
