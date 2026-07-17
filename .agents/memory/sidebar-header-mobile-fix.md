---
name: SidebarHeader mobile duplication fix
description: How to prevent shadcn SidebarHeader from duplicating the MobileHeader logo/title on mobile viewports.
---

## The rule

When a DashboardLayout uses both a sticky `MobileHeader` (md:hidden) AND a `SidebarHeader` inside the sidebar, always add `hidden md:flex` to the `SidebarHeader` className. Without it, the SidebarHeader renders inside the Sheet drawer on mobile and duplicates the portal label.

```tsx
// ✅ Correct — hidden on mobile, flex on desktop
<SidebarHeader className="p-4 flex-row items-center gap-2 hidden md:flex">

// ❌ Wrong — always visible, duplicates label inside mobile Sheet drawer
<SidebarHeader className="p-4 flex flex-row items-center gap-2">
```

**Why:** shadcn's `Sidebar` with `collapsible="offcanvas"` renders as a Sheet (portal) on mobile. The Sheet renders the full children tree including SidebarHeader. CSS breakpoints (`md:flex`) still apply inside portals because they are viewport-width–based, not container-width–based. Applying `hidden md:flex` effectively hides the SidebarHeader inside the Sheet while keeping it visible in the inline desktop sidebar.

**How to apply:** Whenever creating or editing a layout that has both a MobileHeader and a SidebarHeader, verify the SidebarHeader has `hidden md:flex` in its className. The MobileHeader already shows the logo, NotificationBell, and hamburger — the SidebarHeader is redundant on mobile.

**Applies to:** `dashboard-layout.tsx` (DashboardLayout) and `payout-admin-layout.tsx` (PayoutAdminLayout). Any future layout using the same pattern needs this guard.

**Smoke test guard:** `scripts/e2e/smoke-tests.spec.ts` — "no duplicate portal label on mobile" tests enforce that visible count of "Admin Console" / "Merchant Portal" is ≤ 1 at 375px viewport.
