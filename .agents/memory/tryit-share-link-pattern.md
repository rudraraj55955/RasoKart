---
name: Try It panel share-link pattern
description: How the RasoKart API docs page shares a "Try It" request setup via URL, and how it auto-opens the right collapsed section/panel.
---

The api-docs page has many collapsible `Section` wrappers, each containing one or more `TryItPanel` instances (matched by `method`+`path`, not by id/ref). To let a shared link auto-open the *correct* collapsed Section without threading per-section "which endpoints are inside me" props by hand, a React context (`SharedPresetContext`) carrying the decoded shared preset is provided at the page root, and `Section` recursively walks its own `children` (`Children.forEach` + `isValidElement`, checking `child.type === TryItPanel`) to decide at first render whether it should start open.

**Why:** Manually wiring "does this section contain the shared endpoint" as an explicit prop would require touching every one of the ~15 `<Section>` call sites and keeping them in sync as endpoints are added/removed. Context + child introspection makes it automatic and typo-proof.

**How to apply:** If you add a new endpoint's `TryItPanel` inside any `Section` on this page, no wiring is needed for share-links to keep working — the recursive scan picks it up automatically as long as it's a descendant (even nested in a `<div>`) of the `Section`.

Encoding approach: preset (`method`, `path`, `pathValues`, `queryParams`, `body`) is JSON-stringified, UTF-8 encoded via `TextEncoder`, base64url-encoded (`+`/`/`/`=` replaced), and placed in a `?tryit=` query param on the current page URL — no server-side storage. After decoding on mount, the query param is stripped via `history.replaceState` so a reload/re-share of the URL doesn't redundantly re-toast.

**Cross-panel preset sync:** each `TryItPanel` keeps its own presets in local component state (loaded once from the shared `rasokart_tryit_presets` localStorage blob). A page-level "Manage saved presets" dialog can rename/delete any preset directly in that blob. To keep every open panel's state in sync without lifting state to a shared store, any write path (`persistPresetsForEndpoint`/rename/delete) goes through one `saveAllPresets()` that both writes localStorage and dispatches a `window` custom event (`rasokart-tryit-presets-changed`); each `TryItPanel` and the manage dialog subscribe to that event and reload their own slice. Cheap pub/sub beats prop-drilling or context here since panels are deeply nested and dynamically rendered per endpoint.
