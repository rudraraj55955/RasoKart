---
name: Orval and js-yaml v5 incompatibility
description: Why API code generation currently fails before reading the OpenAPI document.
---

Secure `js-yaml` releases expose named ESM exports, while affected Orval 8.x builds import a default export. Keep Orval patched to use a namespace import so codegen can start without downgrading `js-yaml`.

**Why:** The same failure occurs under Node 22 and Node 24, so changing the runtime does not resolve it. Downgrading `js-yaml` would reintroduce dependency advisories.

**How to apply:** When upgrading Orval, verify and refresh the pnpm patch against its generated config bundle filename. Run codegen separately from the normal build because existing spec-level generation errors may be unrelated to dependency loading.