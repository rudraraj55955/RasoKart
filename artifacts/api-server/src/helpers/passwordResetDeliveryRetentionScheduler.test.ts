/**
 * Password-reset delivery cleanup history regression coverage.
 *
 * Included in the standard API test suite and available as a focused check:
 *   pnpm --filter @workspace/api-server run test:password-reset-delivery-cleanup
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanupRunHistoryTable, db } from "@workspace/db";
import {
  loadPasswordResetDeliveryCleanupHistory,
  runPasswordResetDeliveryCleanup,
} from "./passwordResetDeliveryRetentionScheduler";

type HistoryRow = {
  id: number;
  type: string;
  trigger: string;
  triggeredBy: string;
  status: string;
  summary: string | null;
  deleted: number;
  retentionDays: number;
  ranAt: Date;
};

const originalDb = {
  select: (db as any).select,
  insert: (db as any).insert,
  delete: (db as any).delete,
  execute: (db as any).execute,
};

afterEach(() => {
  Object.assign(db as any, originalDb);
});

function installDbHarness() {
  const history: HistoryRow[] = [];
  let nextId = 1;
  let deleteError: Error | null = null;
  let deletedCount = 0;

  (db as any).select = (fields: Record<string, unknown>) => {
    const isRetentionLookup = Object.keys(fields).length === 1 && "value" in fields;
    const rows = isRetentionLookup
      ? [{ value: "30" }]
      : history
          .filter((row) => row.type === "password_reset_delivery")
          .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime() || b.id - a.id)
          .map((row) => {
            const selected: Record<string, unknown> = {};
            for (const key of Object.keys(fields)) selected[key] = row[key as keyof HistoryRow];
            return selected;
          });

    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (limit: number) => Promise.resolve(rows.slice(0, limit)),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };

  (db as any).delete = () => ({
    where: async () => {
      if (deleteError) throw deleteError;
      return { rowCount: deletedCount };
    },
  });

  (db as any).insert = (table: unknown) => ({
    values: async (values: Omit<HistoryRow, "id" | "ranAt">) => {
      assert.equal(table, cleanupRunHistoryTable);
      history.push({
        ...values,
        id: nextId++,
        ranAt: new Date(Date.now() + nextId),
      });
    },
  });

  (db as any).execute = async () => {
    const ordered = history
      .filter((row) => row.type === "password_reset_delivery")
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime() || b.id - a.id);
    const keep = new Set(ordered.slice(0, 20).map((row) => row.id));
    for (let index = history.length - 1; index >= 0; index--) {
      if (history[index]?.type === "password_reset_delivery" && !keep.has(history[index]!.id)) {
        history.splice(index, 1);
      }
    }
  };

  return {
    history,
    failDeletesWith(error: Error) {
      deleteError = error;
    },
    allowDeletes(count = 0) {
      deleteError = null;
      deletedCount = count;
    },
  };
}

describe("password reset delivery cleanup history", () => {
  it("records scheduled and manual failures with a safe summary", async () => {
    const harness = installDbHarness();
    const rawError = new Error('database error: relation "email_delivery_logs" does not exist');
    harness.failDeletesWith(rawError);

    await assert.rejects(() => runPasswordResetDeliveryCleanup("scheduled"), rawError);
    await assert.rejects(() => runPasswordResetDeliveryCleanup("manual"), rawError);

    const returned = await loadPasswordResetDeliveryCleanupHistory();
    assert.deepEqual(
      returned.map((row) => [row.trigger, row.status]),
      [
        ["manual", "failed"],
        ["scheduled", "failed"],
      ],
    );
    for (const row of returned) {
      assert.equal(
        row.summary,
        "Cleanup could not complete. Check server logs for technical details.",
      );
      assert.ok(!row.summary?.includes(rawError.message));
    }
    assert.ok(harness.history.every((row) => !row.summary?.includes(rawError.message)));
  });

  it("puts a later success first and clears the active failure state", async () => {
    const harness = installDbHarness();
    harness.failDeletesWith(new Error("raw database connection detail"));
    await assert.rejects(() => runPasswordResetDeliveryCleanup("scheduled"));

    harness.allowDeletes(4);
    assert.deepEqual(await runPasswordResetDeliveryCleanup("manual"), {
      deleted: 4,
      retentionDays: 30,
    });

    const returned = await loadPasswordResetDeliveryCleanupHistory();
    assert.equal(returned[0]?.status, "success");
    assert.equal(returned[0]?.summary, null);
    assert.equal(returned[0]?.trigger, "manual");
    assert.equal(returned[1]?.status, "failed");
  });

  it("keeps only the newest 20 attempts", async () => {
    const harness = installDbHarness();
    harness.allowDeletes();

    for (let attempt = 0; attempt < 23; attempt++) {
      await runPasswordResetDeliveryCleanup(attempt % 2 === 0 ? "scheduled" : "manual");
    }

    const returned = await loadPasswordResetDeliveryCleanupHistory();
    assert.equal(returned.length, 20);
    assert.equal(harness.history.length, 20);
    assert.equal(returned[0]?.id, 23);
    assert.equal(returned.at(-1)?.id, 4);
  });
});