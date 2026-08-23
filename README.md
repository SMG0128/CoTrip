# CoTrip — AI 协同行程规划微信小程序

CoTrip 是一个面向**多人线下活动协调**的微信小程序。参与者的碎片化需求以自然语言表达（"我只有上午有空"、"想在天河打羽毛球"、"预算控制在人均100"），AI 层持续将其转化为结构化约束，并维护一份唯一可执行的共同计划。

> **大家负责表达想法，AI 负责把想法变成共同计划。**

CoTrip 不是 AI 聊天机器人。AI 是行程背后的"多人意图协调层"，核心循环：

```
创建行程 → 邀请好友 → 原始评论 → AI 约束提取 → 约束库
→ 冲突检测 → 规划引擎 → Provider 检索 → 可信实体
→ 结构化计划 → 前端渲染 → 个人路线 → 通知 → 完成 → 封板
```

- 完整产品规格：[`AI_Coexistence_Trip_MiniProgram_V1.md`](./AI_Coexistence_Trip_MiniProgram_V1.md)
- 后端详细说明：[`server/README.md`](./server/README.md)

## Current Capabilities

当前已实际实现并通过测试的能力（后端 32/32、前端 17 个测试文件全绿）：

- **Real WeChat authentication** —— `wx.login` → 后端 `code2Session` → CoTrip 用户 + HMAC token；openid 不出后端。
- **Real Trip persistence** —— Trip 经 Route → Service → Repository 分层落盘 `server/data/trips.json`（原子写入，重启保留）。
- **Server-generated roomCode** —— 创建 Trip 时生成全局唯一 7 位房间号，旧数据自动回填。
- **Trip completion flow** —— `POST /trips/:id/complete`：仅 creator 可完成；幂等（重复完成返回原快照，不重置 `completedAt`）；DRAFT/CANCELLED 拒绝（409）；前端二次确认 + 防重复提交；完成后移入历史行程。
- **Multiple active trips** —— 首页展示全部进行中行程（最新在前），每张卡独立导航。
- **Native WeChat sharing** —— 分享卡片直达 Join 落地页（携带 roomCode）。
- **Navigation-style route recommendations** —— 见下节。
- **Tencent Location Service integration** —— POI Search + Direction（walking / transit）已真实配置并跑通，直连 WebService API。
- **Guangzhou Metro / Bus presentation layer** —— 线路徽章由本地 registry 维护（编号线路 / APM / 广佛），公交徽章使用 Provider 真实线路名，不依赖 Provider 线路色、不伪造线路。

尚未实现：真实多人加入（`POST /trips/join`）、实时同步 / WebSocket、评论与计划的后端持久化。

## Route Recommendations

行程详情「我的推荐」是导航风格的 **Route Picker**：最多 3 条方案并排比较，三条同级、结构统一——**Provider 返回几条就展示几条，绝不伪造补足**。

### 方案选择（Route Picker）

- **统一行结构**：Route 1 / 2 / 3 使用同一套行布局（左侧「路线 N」+ 折叠摘要，右侧总时长 / 总价）；Route 1 额外带「推荐」徽章（推荐由 provider 排序决定，只是第 1 条的可选徽章，不改变行结构）。
- **手风琴交互**：默认展开第一条；点击已展开项可**全部收起**；任意时刻**最多展开一条**。
- **折叠摘要（compact route summary）**：按真实 leg 顺序的分段链（步行时长 › 线路名 › …），单行受控、超长自动裁切，不撑高行。
- **展开详情（travel-leg details）**：逐腿展示图标、标题、时长、距离 / 上车站→下车站、方向终点站、站数、步行指引原文，以及统一目的地脚注（目的地 + 预计到达 + 导航）。

### 交通方式展示

- **WALK / METRO / BUS 独立呈现**：各自使用专属图标与文案（步行=指引 + 距离；乘车=线路名 + 上下车站）。
- **广州地铁徽章（本地 presentation registry）**：`utils/guangzhou-metro.ts` 本地维护广州线路色与徽章文本——编号线路徽章仅显示数字、**APM 显示「APM」、广佛线显示「广佛」**；无网络依赖，不写回 provider DTO。
- **公交徽章**：使用 Provider 返回的**真实线路名**，蓝底白字，绝不编造线路。
- **票价（fare）**：只展示 Provider 真实价格（route 级票价，缺失时以线路级票价多程汇总兜底）；**未知价格直接隐藏**，不显示假占位符。

### 数据与降级

- 数据来源：腾讯位置服务 WebService API（**POI Search** 解析目的地坐标 + **Direction walking / transit** 并行请求）。
- 导航通过 `wx.openLocation` 交给微信内置地图完成，CoTrip 不自行实现导航。
- **失败不回退假路线**：Provider / 地点解析 / 定位失败均显示明确失败态与重试入口；绝不伪造路线、票价或到达时间。

## Tencent Map Setup

腾讯位置服务 WebService API（POI Search + Direction walking/transit）已**真实配置并在本地跑通**。真实 Key **不进入 Git**，仓库内始终为占位符：

1. 在 [腾讯位置服务控制台](https://lbs.qq.com/) 创建应用并申请 Key，勾选所需 **WebService API** 能力（PlaceSearch / Direction），建议配置配额限额与用量告警。
2. 将 Key 填入 `config/tencent-map.ts` 替换占位符 `YOUR_TENCENT_MAP_KEY`（仅本地修改，**勿提交真实 Key**）。
3. 在小程序管理后台「开发设置 → 服务器域名」添加 request 合法域名 `https://apis.map.qq.com`。
4. 在微信小程序控制台配置位置权限与《用户隐私保护指引》（`permission.scope.userLocation` 与 `requiredPrivateInfos` 已在 `app.json` 声明）。

**Never commit production/private keys.** 未配置 Key 时路线功能显示「暂未配置地图服务」，不会伪造数据。

## Known Limitations

- 真实多人房间加入后端尚未实现；本地 Mock 已具备 preview/join 完整交互，real mode 会明确报 `TRIP_JOIN_BACKEND_UNAVAILABLE`，绝不回退 Mock。
- 定位的运行时隐私授权弹窗（privacy authorization flow）尚未完整实现。
- 腾讯地图真机 E2E 依赖人工完成 Key / 合法域名 / 隐私配置。
- 地图预览（Map Preview）尚未实现。
- 本阶段未使用后端代理转发腾讯地图请求（客户端受限 Key 直连）。

## V0.3 Room Foundation（上一轮交付）

本轮完成了**基于房间号（roomCode）的行程协作地基**，前后端与测试全部就绪：

### 房间号体系

- **服务器生成房间号**：创建 Trip 时由后端生成 7 位人读友好房间号——仅使用不易混淆字符集（排除 `0/O`、`1/I/L`），全大写；全局唯一，碰撞自动重试；禁止客户端生成或从 tripId/时间戳拼造。
- **历史数据回填**：旧 Trip 在读取时自动补齐缺失的 `roomCode`，原字段完整保留。
- **按房间号查找**：后端支持 `findByRoomCode` 查询，非法格式安全返回空。

### 分享与加入（Local Join Foundation）

- **原生微信分享**：行程详情通过 `onShareAppMessage` 分享卡片邀请好友。有房间号 → 卡片直达加入落地页（roomCode 经 `encodeURIComponent`）；无房间号 → 安全回退分享首页，绝不伪造房间号、绝不声称可加入当前行程。
- **Join 落地页**（`pages/join-trip/`）：通过 `TripService.getJoinPreview` 加载最小公开预览；本地 Mock 支持幂等 `joinTrip`，仅在 service 返回 Trip 后进入详情。
- **首页房间入口**：首页提供房间号手动输入（自动 trim / 去空格 / 大写归一化），导航至同一落地页。
- **登录续接**：未登录点击加入时统一保存 `pendingJoinRoomCode`；登录成功只返回同一 Join 落地页，由用户再次明确点击加入，成功后清理 pending context。

### 体验与架构改进

- **通用化 Trip Card**：卡片状态由真实事件数据推导（`EMPTY` / `SINGLE_EVENT` / `MULTI_EVENT`），事件图标按类型统一映射，未知类型回退 generic 图标；移除了对 Mock 数据语义（羽毛球/餐厅）的隐式依赖。
- **多进行中行程**：首页展示全部进行中行程列表（最新在前），每张卡独立导航至各自详情；不再只取 `trips[0]`。
- **修复创建后跳转**：新建行程正确携带新 Trip id 导航至详情页，不再回落到旧行程。
- **登录页 / 新建行程页视觉刷新**。

### 测试覆盖

- 后端：22/22 通过（含 6 项房间号测试：生成格式、全局唯一、碰撞重试、findByRoomCode、legacy 回填、重启持久化）。
- 前端：13 个测试文件全部通过（新增 `trip-share`、`trip-card`、`home-multi-trips`）。

## 项目结构

```
├── app.ts / app.json / app.wxss    # 小程序入口
├── pages/                          # 页面（四件套 .ts/.json/.wxml/.wxss）
│   ├── login / home / profile      #   登录、首页、我的
│   ├── trip-create / trip-detail   #   新建行程、当前行程
│   ├── join-trip                   #   加入落地页（V0.3 新增）
│   └── trip-history* / place-detail
├── components/                     # 共享组件（trip-card、plan-board 等）
├── types/                          # 领域模型（Trip、Plan、Event、Constraint…）
├── core/                           # 纯规划逻辑（约束解析→冲突检测→规划引擎）
├── services/                       # 服务接口 + mock/ 与 real/ 实现
├── config/auth.ts                  # 认证模式切换（mock | real）
├── utils/                          # 纯函数工具（trip-share、trip-card、route-options-ui、guangzhou-metro…）
├── mock/                           # Mock 数据
├── tests/                          # 前端单元测试（自研轻量运行器）
└── server/                         # Node.js + Express 后端
    ├── src/routes/                 #   /auth /trips 路由
    ├── src/services/               #   微信登录、token 签发、Trip 业务
    ├── src/repositories/           #   JSON 文件持久化
    ├── src/utils/room-code.ts      #   房间号生成与校验（V0.3 新增）
    └── tests/                      #   后端测试
```

## 架构要点

1. **AI 只输出结构化数据**，不产出页面文案；前端由数据渲染 UI。
2. **AI 与真实 Provider 严格分离**：场馆、价格、评分、路线等真实世界事实只能来自 Provider 层（腾讯地图等），AI 不虚构。
3. **结构化值而非字符串**：时间必须是带时区的 ISO-8601 对象，地点必须有 id/坐标/地址，价格必须有金额/币种/单位。
4. **HARD vs SOFT 约束**：硬约束不可静默违反；无法同时满足时必须显式抛出冲突，由参与者决策。
5. **建议计划 vs 当前计划**：重大变更走建议→确认流程，微调自动生效。
6. **共享计划 + 个人路线**：个人出发地默认私有，仅用于计算本人路线。
7. **行程状态机**：`DRAFT → ACTIVE → COMPLETED`（+`CANCELLED`）；COMPLETED 为冻结封板快照。
8. **优雅降级**：第三方服务或 AI 失败时保留最近可用计划，未解析评论留存待重解析，不虚构任何数据。

## 快速开始

### 小程序端

```bash
npm install          # 安装 TypeScript 与小程序类型声明
npm run typecheck    # 严格类型检查
npm test             # 编译至临时目录并运行全部前端测试
```

开发预览：用**微信开发者工具**导入仓库根目录即可（TypeScript 由内置编译插件处理，无 CLI 构建）。替换 `project.config.json` 中的 `touristappid` 为正式 AppID 后可使用真实登录。

### 后端

```bash
cd server
npm install
cp .env.example .env   # 填入 WECHAT_APPID / WECHAT_SECRET / AUTH_TOKEN_SECRET / PORT
npm run dev            # 开发模式（ts-node），默认 http://localhost:3000
npm run build && npm start   # 生产模式
npm run typecheck && npm test
```

健康检查：`GET http://localhost:3000/health`

### 认证模式

编辑 `config/auth.ts`：

- `mode: 'mock'` —— 前端无需后端即可运行（开发默认）。
- `mode: 'real'` —— 走 `wx.login` → CoTrip 后端 → 微信 `code2Session`。后端不可用时登录明确失败，**不会**回退 Mock。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/auth/login` | 用 `wx.login` code 登录，返回 `{ token, user }` |
| GET | `/auth/profile` | 校验 token，返回公开用户信息 |
| PATCH | `/auth/profile` | 更新昵称/头像（需登录） |
| POST | `/trips` | 创建当前用户拥有的 Trip（含服务器生成 roomCode） |
| GET | `/trips?status=ACTIVE` | 列出当前用户参与的 Trip |
| GET | `/trips?status=COMPLETED` | 列出当前用户的历史行程 |
| GET | `/trips/:id` | 读取单个 Trip（仅参与者可见） |
| POST | `/trips/:id/complete` | 完成行程（仅 creator，幂等；非法状态迁移返回 409） |

错误统一返回 `{ "error": { "code": "...", "message": "..." } }`。

## 开发约定

- 严格 TypeScript（`strict` + `noImplicitAny` + `strictNullChecks`），不用 `any` 绕过。
- 文件/目录 kebab-case，类型 PascalCase，函数 camelCase；业务规则放 `core/` 或 `services/`，不写进页面处理器。
- 测试为自研轻量运行器：新增测试文件需注册进 `tests/run-tests.ts`（后端为 `server/tests/run-tests.ts`）。
- 提交遵循 Conventional Commits（`feat(core): ...`、`docs: ...`）。

## 安全边界

- `WECHAT_SECRET` / `session_key` / `openid` 仅存在于后端；小程序只持有 CoTrip token 与 userId。
- `creatorId` / `participantIds` 只来自已校验 token，客户端提交的身份字段会被忽略。
- `.env`、`server/data/*.json`、私钥证书文件均在 `.gitignore` 中，切勿提交。

## Roadmap

- [ ] **POST /trips/join** —— 房间号真实加入 API（V0.3 已预留 Join 落地页与房间号校验，接口尚未接通）
- [ ] 评论流与 AI 约束提取接入真实服务
- [ ] 规划引擎对接真实 Provider（地图/地点检索）
- [ ] 通知订阅消息
