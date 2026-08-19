# CoTrip Light 3D Design QA

## Comparison Target

- Source visual truth:
  - C:\Users\32569\AppData\Local\Temp\codex-clipboard-231b5eef-695a-427e-bda3-3d1cf775d0c7.png (Home)
  - C:\Users\32569\AppData\Local\Temp\codex-clipboard-94cd3f81-d1a1-4f2d-9277-6444d7ab064c.png (Trip Detail / Plan)
  - C:\Users\32569\AppData\Local\Temp\codex-clipboard-1d6a5f54-a4b7-467b-90c2-5a4feb196781.png (Trip Detail / Comments)
  - C:\Users\32569\AppData\Local\Temp\codex-clipboard-c66c7c83-9fe8-49c6-8aa0-2ab400523bc9.png (Profile)
- Source dimensions: 941 × 1672 px each.
- Intended CSS viewports: 375, 390, and 430 px wide; Mini Program rpx scaling, density normalized by the simulator.
- State: active trip with plan v4, ranked restaurants, four comments, collapsed debug panel, and profile notification settings.
- Implementation screenshot: not captured.

## Findings

- [P1] Rendered comparison is blocked.
  - Location: WeChat DevTools simulator.
  - Evidence: the open DevTools window contains an older unsaved editor buffer and displays a blank simulator. Reloading it would discard user-owned unsaved state. CLI automation is unavailable because the DevTools service port is disabled; enabling it would change a security setting.
  - Impact: typography, exact spacing, image scale, and wrapping cannot be judged from rendered evidence.
  - Fix: save or discard the existing DevTools buffer, reopen the project from disk, compile, and capture Home, Plan, Comments, and Profile at the three target widths.

## Required Fidelity Surfaces

- Fonts and typography: system font stack and reference hierarchy implemented; rendered weights/wrapping not verified.
- Spacing and layout rhythm: responsive rpx layout and 375 px overrides implemented; rendered comparison blocked.
- Colors and visual tokens: shared canvas, surface, accent, semantic color, radius, and shadow tokens implemented.
- Image quality and asset fidelity: transparent CC0 raster assets inspected directly; final in-layout crop/scale not verified.
- Copy and content: reference labels preserved while live trip, constraint, provider, and notification data remain bound.

## Full-view and Focused Evidence

The four source images were opened and inspected. No valid implementation capture is available, so no side-by-side full-view or focused-region comparison was performed.

## Comparison History

- Pass 1: static implementation completed; npm run typecheck, npm test, JSON parsing, and all 17 asset-reference checks passed.
- Render attempt: blocked by the unsaved DevTools buffer and disabled automation service port. No visual fixes were inferred from the blank simulator.

## Implementation Checklist

- Reopen the project from disk after preserving the existing editor buffer.
- Capture Home, Trip Plan, Trip Comments, and Profile at 375, 390, and 430 px.
- Compare typography, section spacing, long-title wrapping, restaurant truncation, badges, switches, and safe-area input placement.
- Resolve any P0/P1/P2 mismatch, then repeat the comparison.

## Follow-up Polish

- Replace the generic gym and takeaway-cup illustrations with custom racket, metro, and Vietnamese-food renders if image generation becomes available.

## Custom Tab Bar Patch

- Native tab presentation replaced with `custom-tab-bar/`; routes remain `pages/home/home` and `pages/profile/profile` and continue through `wx.switchTab`.
- Bar geometry: 28rpx margins and 100rpx height at 375px; 30rpx margins and 104rpx height at 390px and 430px.
- Safe-area behavior: the pill uses `bottom: calc(env(safe-area-inset-bottom) + 12rpx)` with no full-width safe-area container.
- Home and Profile reserve `140rpx + env(safe-area-inset-bottom)`, leaving 24–28rpx between scroll content and the floating pill.
- Static checks at 375/390/430 widths passed. Rendered verification remains part of the existing DevTools blocker above.

final result: blocked
