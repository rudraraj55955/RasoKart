---
name: smartRouting.ts recurring merge corruption
description: Task agent merges repeatedly corrupt the same routes in smartRouting.ts — pattern and fix checklist for each recurrence.
---

## The pattern

Every few merged tasks, smartRouting.ts gets the same set of corruptions injected. The corrupted file still compiles (mostly) but fails at runtime or in the priority-conflict test suite. Symptoms:

- `pnpm --filter @workspace/scripts run verify-priority-conflict-tests` exits non-zero
- esbuild TransformError: "Expected 'finally' but found 'const'" — means a try/catch block was split open by injected code
- TypeScript errors referencing `rule`, `ruleId`, `effectivePriority`, `uncovered`, `keys`, `configId`, `excludeRuleId` as undefined names
- TypeScript errors saying `.successRate`, `.lastComputedAt`, `.amount`, `.createdAt`, `.total`, `.failed` don't exist on `systemConfigTable` row type

## Canonical corruption sites (check all on each occurrence)

| Route | Corruption | Correct fix |
|---|---|---|
| `GET /configs` | queries `systemConfigTable` | `routingConfigsTable.orderBy(asc(...id))` |
| `POST /configs` | inserts into `routingRulesTable` with rule fields | insert into `routingConfigsTable` with config fields |
| `PUT /configs/:id` | select/update `routingRulesTable` with rule fields | select/update `routingConfigsTable` with config fields |
| `GET /configs/:id/rules` | `.where(config.id)` — `config` undefined | `.where(eq(...configId, id)).orderBy(asc(...priority))` |
| `POST /configs/:id/rules` | orphaned `rulesWhere`/`rule`/`ruleId`/`effectivePriority` refs, syntax break | fetch existing config by `configId`; priority conflict check with `getNextFreePriority(configId, effectivePriority)` |
| `PUT /rules/:id` (first conflict branch) | `effectivePriority`/`ruleId`/`rule` undefined | use `priority` directly; `getNextFreePriority(existing.configId, priority, id)` |
| `PUT /rules/:id` (re-enable branch) | `rule?.priority`/`ruleId` undefined | `priority !== undefined ? priority : existing.priority`; `getNextFreePriority(existing.configId, effectivePriority, id)` |
| `DELETE /rules/:id` label | labeled DELETE but has PUT body | relabel as `PUT /rules/:id`; add a separate real DELETE after |
| `GET /failure-trend` | queries `systemConfigTable` | `routingLogsTable` with `to_char` groupBy SQL |
| `GET /status` | orphaned `rulesWhere = excludeRuleId != null ? ...` block | delete the two orphaned lines |
| `GET /metrics` | queries `systemConfigTable` | `providerMetricsTable.where(timeWindow).orderBy(desc successRate)` |
| `GET /logs` | queries `systemConfigTable` | `routingLogsTable.orderBy(desc createdAt).limit.offset` |
| Coverage-check amountSet loop | `uncovered[0]` / `uncovered[uncovered.length-1]` | `Number(r.minAmount)` / `Number(r.maxAmount)` |
| `GET /failover-events` snoozedUntil | `new Date(Date.now() + minutes * 60 * 1000)` | read snoozeRow from DB; check `> new Date()` before returning |

## Fix workflow

1. Run `pnpm --filter @workspace/api-server exec tsc --noEmit` — lists all TS errors by line
2. For each error, read ±20 lines around it and compare to the correct version from the last known-good commit
3. The last known-good commit before the most recent corrupting merge is discoverable via `git log --oneline`
4. After all edits: `tsc --noEmit` must be clean
5. Run `pnpm --filter @workspace/scripts run verify-priority-conflict-tests` — all guards must pass
6. Run `node --import tsx/esm --test lib/db/src/schema/systemConfig.coverage.test.ts` — 3/3 must pass
7. Restart both workflows

## Why it happens

Task agents editing `smartRouting.ts` produce bad git merges that mix bodies from different route handlers. The file is long (~1050 lines) and several route handlers share similar local variable names (`id`, `existing`, `conflicting`, `updateSet`), making merge conflicts easy to resolve incorrectly.

**How to apply:** After every batch of task merges, run the TypeScript check. If any error names `rule`, `ruleId`, `effectivePriority`, `uncovered`, `keys`, `configId`, `excludeRuleId`, or property errors against `systemConfigTable` rows — go through the full checklist above.
