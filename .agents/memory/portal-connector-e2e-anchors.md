---
name: Portal connector E2E anchors
description: Durable patterns for reliable portal connector UI regression tests.
---

For duplicate-submit regressions, inject the second activation synchronously from the first submission's client request boundary. Sequential DOM click dispatches—even in one browser task—can still let React flush the first discrete event and only prove the disabled state, not the ref-based race guard.

**Why:** React state updates do not synchronously re-render the DOM, so a second event in the same task can bypass a state-only loading flag. Provider-facing display names can also change with branding or catalogue configuration while the identifier input and action contract remain stable.

**How to apply:** Mock the portal endpoints, hold the first submit response in flight, install a request-boundary test hook before the app module loads, and make its first submit synchronously dispatch the second click. Count the POSTs and assert the injection ran. Locate the provider card through its stable, provider-specific form control rather than marketing copy. When OTP submission intentionally clears the code, assert the cleared input and disabled idle action after the response instead of expecting the button to re-enable.