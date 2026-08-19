# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## Project Status

This repository currently contains **only a product specification document** (`AI_Coexistence_Trip_MiniProgram_V1.md`). There is no source code, build configuration, or test suite yet. The task is to build a WeChat Mini Program (微信小程序) from this spec.

## Commands

No build, lint, or test commands exist yet because there is no code. When scaffolding the project, establish the standard WeChat Mini Program toolchain:

- **Scaffold / develop**: Use the WeChat DevTools (微信开发者工具) to open the project root. The mini program entry is `app.js` / `app.json` / `app.wxss` at the root, with pages registered in `app.json`.
- **Build / preview**: Triggered from WeChat DevTools (compile + preview on device). There is no CLI build step by default.
- **Lint / test**: None configured. If you add a test runner, prefer one that runs in the WeChat runtime or a Node-based unit test for the pure logic modules (constraint extraction, conflict detection, planning engine).

## Product Overview

A WeChat Mini Program for **multi-person offline activity coordination**. The core idea: participants express fragmented needs in natural language (e.g. "I'm only free after 10am", "I want to play badminton in Tianhe", "keep it cheap"), and an AI layer continuously converts these into structured constraints and maintains a single executable shared plan.

The product is **not** an AI chat bot. AI is the "multi-person intent coordination layer" behind the trip. The core loop:

```
Create Trip → Invite → Raw Comments → AI Constraint Extraction → Constraint Store
→ Conflict Detection → Planning Engine → Provider Search → Verified Entities
→ Structured Plan → Frontend Render → Personal Route → Notification → Complete → Archive
```

## Big-Picture Architecture

The following principles span the entire document and must be respected when implementing any feature.

### 1. AI outputs structured data, never page copy

AI must never emit display text or natural-language plans. Its output is always structured objects (events, constraints, plans). The frontend renders UI from that data. Example of the correct shape for a plan:

```json
{
  "events": [
    { "id": "event_001", "type": "SPORT", "time": {}, "location": {}, "price": {} }
  ]
}
```

### 2. AI and real-world Providers are strictly separated

AI must **not fabricate** real-world facts: venues, restaurants, addresses, ratings, prices, or routes. The Provider layer (Tencent Map, Dianping, future APIs) supplies verified entities. AI only understands intent, extracts constraints, ranks real candidates, and explains recommendations. Routes are computed by map services, not by the LLM.

### 3. Core data model

The domain objects (each with a defined schema in the spec) are: `Trip`, `Participant`, `Comment`, `Constraint`, `Plan`, `Event`, `Time`, `Location`, `Venue`, `Restaurant`, `Price`, `Route`, `ExternalAction`, `Notification`.

Key invariants:
- **Comment** always preserves the raw user text (for display, re-parsing, debugging, audit).
- **Time** must be a structured ISO-8601 object with timezone (e.g. `Asia/Shanghai`), never a bare string like "下午两点".
- **Location** must be a structured real place (id, name, lat/lng, address, district, city), never just a name.
- **Price** is structured (`amount`/`min`/`max` + `currency` + `unit`), never natural language.
- **ExternalAction** abstracts third-party jumps (URL / API / Map / MiniProgram). AI outputs entities, not third-party links; tokens and POI IDs are managed by the Provider/backend layer.

### 4. HARD vs SOFT constraints and conflicts

Constraints are classified as `HARD` (must not be violated: time windows, budget max, fixed district) or `SOFT` (AI may trade off: "prefer cheap", "prefer metro"). When two HARD constraints cannot both be satisfied, AI must surface an explicit `Conflict` — it must never silently drop one. AI may propose alternatives, but participants decide.

### 5. Suggested Plan vs Current Plan

AI should not tear down a settled plan because of a single comment. Distinguish a `Suggested Plan` from the `Current Plan`. Major changes (venue swap, time shift, region change, budget increase) go through a suggestion → confirmation flow; minor adjustments auto-apply.

### 6. Shared plan + personal execution

A single Trip has two views: the **shared plan** ("我们怎么办" — what we do together) and each participant's **personal route** ("我怎么去" — how I get there). Personal departure locations are private by default and only used to compute that user's route; the shared plan only exposes public meeting/activity locations.

### 7. Trip state machine and permissions

Trip states: `DRAFT → ACTIVE → COMPLETED`, plus `CANCELLED`. `COMPLETED` is a frozen snapshot (封板) with all editing removed. All participants can view the plan, add needs, and see their own route; the creator additionally manages invites, member removal, cancellation, and completion. The creator's personal preferences carry no higher AI weight than anyone else's.

### 8. Failure and degradation

The system must degrade gracefully when third-party services or AI fail: keep the last good Plan, keep comments saved for later re-parsing, hide navigation if maps fail, never fabricate ratings/prices, and clearly tell the user when a re-plan failed.

### 9. V1 scope is deliberately frozen

Do not add features outside the core loop (no standalone AI chat page, no social/friend systems, no photo albums, no accounting, no check-ins, no points/leaderboards, no content community, no AI persona). Everything must serve "multi-person scattered needs → shared plan".

## Page Tree (V1)

```
微信登录 → 首页 (新建行程 / 当前行程 / 推荐 / 历史行程 / 我的)
新建行程 (区域限定 / 时间范围 / 事件简述 / 创建)
当前行程 (AI 当前计划 / 邀请好友 / 我的推荐 / 大家的想法 / 需求输入)
地点详情 (基础信息 / AI 推荐理由 / 地图 / 怎么去 / 第三方详情)
历史行程 (历史列表 / 封板详情)
我的 (微信信息 / 行程统计 / 通知授权 / 隐私 / 关于)
```

## Design Judgment Standard

When in doubt about whether a feature belongs, apply the product's core expression:

> **大家负责表达想法，AI 负责把想法变成共同计划。** (Everyone expresses ideas; AI turns them into a shared plan.)

The full authoritative spec is `AI_Coexistence_Trip_MiniProgram_V1.md` — read it before implementing any module.