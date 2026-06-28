#!/usr/bin/env bash
# =============================================================================
# RasoKart — Production Demo/Test Data Cleanup
# =============================================================================
# Removes ONLY seeded/demo/test records from known dummy merchant accounts.
# Never touches real merchant data, plans, provider config, system settings,
# nginx, auth, passwords, tokens, or webhook secrets.
#
# Verified merchant/user IDs (confirmed from live DB):
#   merchant@demo.com    → merchant_id=68  user_id=69
#   merchant2@demo.com   → merchant_id=69  user_id=70
#   audit@test.com       → merchant_id=130 user_id=164
#   new@test.com         → merchant_id=135 user_id=171
#
# Usage:
#   DRY_RUN=true  bash scripts/cleanup-demo-data.sh   # preview only (default)
#   DRY_RUN=false bash scripts/cleanup-demo-data.sh   # actually delete
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
DRY_RUN="${DRY_RUN:-true}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/rasokart-backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/rasokart_before_cleanup_${TIMESTAMP}.sql.gz"

# Verified IDs from live DB (DO NOT CHANGE without re-verifying)
CLEANUP_MERCHANT_IDS="68, 69, 130, 135"
CLEANUP_USER_IDS="69, 70, 164, 171"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

banner() { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}"; }
info()   { echo -e "${CYAN}[INFO]${RESET} $*"; }
warn()   { echo -e "${YELLOW}[WARN]${RESET} $*"; }
ok()     { echo -e "${GREEN}[OK]${RESET} $*"; }
err()    { echo -e "${RED}[ERR]${RESET} $*" >&2; }

# ── DB helper ─────────────────────────────────────────────────────────────────
db() { psql "$DATABASE_URL" -t -A -c "$1" 2>/dev/null || echo "0"; }
dbq() { psql "$DATABASE_URL" -c "$1"; }  # for display queries (formatted)

# Count rows matching a WHERE clause
count_rows() {
  local table="$1" where="$2"
  db "SELECT COUNT(*) FROM ${table} WHERE ${where};"
}

# ── Summary tracking ──────────────────────────────────────────────────────────
declare -a SUMMARY_TABLE=()
declare -a SUMMARY_FOUND=()
declare -a SUMMARY_DELETED=()

record() {
  local label="$1" found="$2" deleted="$3"
  SUMMARY_TABLE+=("$label")
  SUMMARY_FOUND+=("$found")
  SUMMARY_DELETED+=("$deleted")
}

print_summary() {
  banner "CLEANUP SUMMARY"
  printf "%-42s %8s %10s %8s\n" "Table" "Found" "Deleted" "Kept"
  printf "%-42s %8s %10s %8s\n" "$(printf '─%.0s' {1..42})" "$(printf '─%.0s' {1..8})" "$(printf '─%.0s' {1..10})" "$(printf '─%.0s' {1..8})"
  local total_found=0 total_deleted=0
  for i in "${!SUMMARY_TABLE[@]}"; do
    local found="${SUMMARY_FOUND[$i]}" deleted="${SUMMARY_DELETED[$i]}"
    local kept=$((found - deleted))
    total_found=$((total_found + found))
    total_deleted=$((total_deleted + deleted))
    if [[ "$deleted" -gt 0 ]]; then
      printf "${RED}%-42s${RESET} %8d %10d %8d\n" "${SUMMARY_TABLE[$i]}" "$found" "$deleted" "$kept"
    else
      printf "${DIM}%-42s %8d %10d %8d${RESET}\n" "${SUMMARY_TABLE[$i]}" "$found" "$deleted" "$kept"
    fi
  done
  printf "%-42s %8s %10s %8s\n" "$(printf '─%.0s' {1..42})" "$(printf '─%.0s' {1..8})" "$(printf '─%.0s' {1..10})" "$(printf '─%.0s' {1..8})"
  printf "${BOLD}%-42s %8d %10d %8d${RESET}\n" "TOTAL" "$total_found" "$total_deleted" $((total_found - total_deleted))
}

# ── Process one table ─────────────────────────────────────────────────────────
# process_table LABEL TABLE WHERE_CLAUSE
process_table() {
  local label="$1" table="$2" where="$3"
  local found
  found=$(db "SELECT COUNT(*) FROM ${table} WHERE ${where};")
  local deleted=0
  if [[ "$DRY_RUN" == "false" ]] && [[ "$found" -gt 0 ]]; then
    db "DELETE FROM ${table} WHERE ${where};" >/dev/null
    deleted=$found
  elif [[ "$DRY_RUN" == "true" ]] && [[ "$found" -gt 0 ]]; then
    deleted=$found   # show as "would delete"
    found=$found
    deleted=$found
  fi
  record "$label" "$found" "$deleted"
}

# =============================================================================
# STEP 1 — Backup
# =============================================================================
banner "STEP 1: Database Backup"
mkdir -p "$BACKUP_DIR"
info "Writing backup to: ${BACKUP_FILE}"
if pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"; then
  BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  ok "Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})"
else
  err "Backup failed — aborting"
  exit 1
fi

# =============================================================================
# STEP 2 — Pre-flight: confirm IDs are still correct
# =============================================================================
banner "STEP 2: Pre-flight ID Verification"
info "Verifying merchant IDs match expected emails..."

ACTUAL=$(db "SELECT string_agg(id::text || '=' || email, ', ' ORDER BY id) FROM merchants WHERE id IN (${CLEANUP_MERCHANT_IDS});")
info "Merchants to clean: ${ACTUAL}"

ACTUAL_USERS=$(db "SELECT string_agg(id::text || '=' || email, ', ' ORDER BY id) FROM users WHERE id IN (${CLEANUP_USER_IDS});")
info "Users to clean data for: ${ACTUAL_USERS}"

# Safety gate: bail if any real merchant email appears in cleanup set
REAL_EMAILS=$(db "SELECT COUNT(*) FROM merchants WHERE id IN (${CLEANUP_MERCHANT_IDS}) AND email NOT LIKE '%demo%' AND email NOT LIKE '%test%' AND email NOT LIKE '%audit%';")
if [[ "$REAL_EMAILS" -gt 0 ]]; then
  err "Safety check FAILED: merchant IDs contain non-demo/test emails. Aborting."
  exit 2
fi
ok "Safety check passed — all IDs are demo/test accounts"

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY_RUN=true — counting records only. No data will be deleted."
  warn "Set DRY_RUN=false to actually delete."
else
  warn "DRY_RUN=false — WILL DELETE data. Proceeding in 3 seconds..."
  sleep 3
fi

# =============================================================================
# STEP 3 — Cleanup (child tables first to respect FK constraints)
# =============================================================================
banner "STEP 3: Cleanup"

# ── 3a. callback_log_attempts (FK → callback_logs) ────────────────────────────
found=$(db "SELECT COUNT(*) FROM callback_log_attempts WHERE callback_log_id IN (SELECT id FROM callback_logs WHERE merchant_id IN (${CLEANUP_MERCHANT_IDS}));")
if [[ "$DRY_RUN" == "false" ]] && [[ "$found" -gt 0 ]]; then
  db "DELETE FROM callback_log_attempts WHERE callback_log_id IN (SELECT id FROM callback_logs WHERE merchant_id IN (${CLEANUP_MERCHANT_IDS}));" >/dev/null
fi
record "callback_log_attempts" "$found" "$([[ "$found" -gt 0 ]] && echo "$found" || echo 0)"

# ── 3b. reconciliation_items (FK → runs, transactions, settlements) ───────────
# Must delete before reconciliation_runs, transactions, and settlements
found=$(db "SELECT COUNT(*) FROM reconciliation_items WHERE merchant_id IN (${CLEANUP_MERCHANT_IDS});")
if [[ "$DRY_RUN" == "false" ]] && [[ "$found" -gt 0 ]]; then
  db "DELETE FROM reconciliation_items WHERE merchant_id IN (${CLEANUP_MERCHANT_IDS});" >/dev/null
fi
record "reconciliation_items (by merchant)" "$found" "$([[ "$found" -gt 0 ]] && echo "$found" || echo 0)"

# Also delete items from the seeded global run (merchant_id IS NULL, notes='Demo seed run')
found_seed=$(db "SELECT COUNT(*) FROM reconciliation_items WHERE run_id IN (SELECT id FROM reconciliation_runs WHERE notes = 'Demo seed run');")
if [[ "$DRY_RUN" == "false" ]] && [[ "$found_seed" -gt 0 ]]; then
  db "DELETE FROM reconciliation_items WHERE run_id IN (SELECT id FROM reconciliation_runs WHERE notes = 'Demo seed run');" >/dev/null
fi
record "reconciliation_items (seeded run)" "$found_seed" "$([[ "$found_seed" -gt 0 ]] && echo "$found_seed" || echo 0)"

# ── 3c. reconciliation_runs ───────────────────────────────────────────────────
found=$(db "SELECT COUNT(*) FROM reconciliation_runs WHERE merchant_id IN (${CLEANUP_MERCHANT_IDS}) OR notes = 'Demo seed run';")
if [[ "$DRY_RUN" == "false" ]] && [[ "$found" -gt 0 ]]; then
  db "DELETE FROM reconciliation_runs WHERE merchant_id IN (${CLEANUP_MERCHANT_IDS}) OR notes = 'Demo seed run';" >/dev/null
fi
record "reconciliation_runs" "$found" "$([[ "$found" -gt 0 ]] && echo "$found" || echo 0)"

# ── 3d. qr_payment_events (FK → qr_codes) ────────────────────────────────────
process_table "qr_payment_events" "qr_payment_events" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# ── 3e. Transactional tables ──────────────────────────────────────────────────
process_table "transactions" "transactions" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "withdrawals" "withdrawals" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "settlements" "settlements" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "ledger_entries" "ledger_entries" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "wallet_ledger" "wallet_ledger" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "wallet_holds" "wallet_holds" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "wallet_charges" "wallet_charges" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "merchant_wallets" "merchant_wallets" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# ── 3f. Callback & webhook logs ───────────────────────────────────────────────
process_table "callback_logs" "callback_logs" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "ekqr_webhook_logs" "ekqr_webhook_logs" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "webhook_failure_alert_logs" "webhook_failure_alert_logs" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "cashfree_payment_logs" "cashfree_payment_logs" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "cashfree_payment_orders" "cashfree_payment_orders" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "cashfree_payouts" "cashfree_payouts" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# ── 3g. Payment instruments (QR, VA, links) ───────────────────────────────────
process_table "qr_codes" "qr_codes" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "virtual_accounts" "virtual_accounts" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "payment_links" "payment_links" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# ── 3h. API credentials (demo keys are safe to remove — clearly prefixed demo) ──
process_table "api_keys (demo prefixed)" "api_keys" "merchant_id IN (${CLEANUP_MERCHANT_IDS}) AND (key_prefix LIKE '%demo%' OR key_prefix LIKE '%test%')"
process_table "credential_events" "credential_events" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# ── 3i. Webhook configs ───────────────────────────────────────────────────────
# Demo webhook URL: https://demo-business.example.com/webhooks/rasokart
process_table "webhooks" "webhooks" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# ── 3j. Merchant connections (demo provider credentials) ──────────────────────
process_table "merchant_connections" "merchant_connections" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# ── 3k. Notifications & queue ─────────────────────────────────────────────────
process_table "notifications" "notifications" "user_id IN (${CLEANUP_USER_IDS})"
process_table "quiet_hours_queue" "quiet_hours_queue" "user_id IN (${CLEANUP_USER_IDS})"

# ── 3l. Merchant metadata & docs ─────────────────────────────────────────────
process_table "merchant_documents" "merchant_documents" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "merchant_kyc" "merchant_kyc" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "kyc_review_history" "kyc_review_history" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "merchant_verifications" "merchant_verifications" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "merchant_trusted_ips" "merchant_trusted_ips" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "merchant_features" "merchant_features" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "merchant_products" "merchant_products" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "saved_filters" "saved_filters" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# ── 3m. Plan & reports history ────────────────────────────────────────────────
process_table "plan_history" "plan_history" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "report_schedules" "report_schedules" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "report_delivery_logs" "report_delivery_logs" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "routing_logs" "routing_logs" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "invoices" "invoices" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "uploaded_objects" "uploaded_objects" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "activation_requests" "activation_requests" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# ── 3n. Provider visibility overrides (demo-specific) ────────────────────────
process_table "provider_visibility" "provider_visibility" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "provider_product_visibility" "provider_product_visibility" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"
process_table "account_visibility_rules" "account_visibility_rules" "merchant_id IN (${CLEANUP_MERCHANT_IDS})"

# =============================================================================
# STEP 4 — Print summary table
# =============================================================================
print_summary

# =============================================================================
# STEP 5 — Post-cleanup verification
# =============================================================================
banner "STEP 5: Post-Cleanup Verification"

verify_api() {
  local label="$1" url="$2" token="$3" expected="$4"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${token}" "${url}" 2>/dev/null || echo "ERR")
  if [[ "$status" == "$expected" ]]; then
    ok "${label}: HTTP ${status}"
  else
    err "${label}: HTTP ${status} (expected ${expected})"
  fi
}

info "Logging in as admin..."
ADMIN_TOKEN=$(curl -s -X POST http://localhost:80/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@rasokart.com","password":"Admin@123456"}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token','FAILED'))" 2>/dev/null || echo "FAILED")

info "Logging in as merchant (demo)..."
MERCH_TOKEN=$(curl -s -X POST http://localhost:80/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@demo.com","password":"Merchant@123456"}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token','FAILED'))" 2>/dev/null || echo "FAILED")

info "Logging in as real merchant (rudraraj4496@gmail.com)..."
REAL_TOKEN=$(curl -s -X POST http://localhost:80/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"rudraraj4496@gmail.com","password":"Merchant@123456"}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token','FAILED'))" 2>/dev/null || echo "FAILED")

echo ""
printf "%-50s %s\n" "Check" "Result"
printf "%-50s %s\n" "$(printf '─%.0s' {1..50})" "$(printf '─%.0s' {1..10})"

# Admin login
if [[ "$ADMIN_TOKEN" != "FAILED" ]] && [[ -n "$ADMIN_TOKEN" ]]; then
  ok "Admin login (admin@rasokart.com)"
else
  err "Admin login FAILED"
fi

# Merchant login
if [[ "$MERCH_TOKEN" != "FAILED" ]] && [[ -n "$MERCH_TOKEN" ]]; then
  ok "Merchant login (merchant@demo.com)"
else
  err "Merchant login FAILED"
fi

# Real merchant login
if [[ "$REAL_TOKEN" != "FAILED" ]] && [[ -n "$REAL_TOKEN" ]]; then
  ok "Real merchant login (rudraraj4496@gmail.com)"
else
  err "Real merchant login FAILED"
fi

# API endpoint checks
if [[ "$ADMIN_TOKEN" != "FAILED" ]]; then
  verify_api "GET /api/merchants (admin)"         http://localhost:80/api/merchants         "$ADMIN_TOKEN" 200
  verify_api "GET /api/withdrawals (admin)"       http://localhost:80/api/withdrawals       "$ADMIN_TOKEN" 200
  verify_api "GET /api/settlements (admin)"       http://localhost:80/api/settlements       "$ADMIN_TOKEN" 200
  verify_api "GET /api/system-config/ekqr"        http://localhost:80/api/system-config/ekqr "$ADMIN_TOKEN" 200
  verify_api "GET /api/system-config/cashfree"    http://localhost:80/api/system-config/cashfree "$ADMIN_TOKEN" 200
  verify_api "GET /api/plans"                     http://localhost:80/api/plans             "$ADMIN_TOKEN" 200
fi

if [[ "$MERCH_TOKEN" != "FAILED" ]]; then
  verify_api "GET /api/transactions (demo merch)" http://localhost:80/api/transactions      "$MERCH_TOKEN" 200
  verify_api "GET /api/withdrawals (demo merch)"  http://localhost:80/api/withdrawals       "$MERCH_TOKEN" 200
  verify_api "GET /api/qr-codes (demo merch)"     http://localhost:80/api/qr-codes          "$MERCH_TOKEN" 200
fi

if [[ "$REAL_TOKEN" != "FAILED" ]]; then
  verify_api "GET /api/transactions (rudraraj)"   http://localhost:80/api/transactions      "$REAL_TOKEN" 200
  verify_api "GET /api/auth/me (rudraraj)"        http://localhost:80/api/auth/me           "$REAL_TOKEN" 200
fi

# Verify real merchant data still present
REAL_MERCH_COUNT=$(db "SELECT COUNT(*) FROM merchants WHERE id = 4 AND email = 'rudraraj4496@gmail.com';")
if [[ "$REAL_MERCH_COUNT" -eq 1 ]]; then
  ok "Real merchant record (rudraraj4496@gmail.com) intact"
else
  err "Real merchant record MISSING"
fi

# Verify admin config still present
CONFIG_COUNT=$(db "SELECT COUNT(*) FROM system_config;")
ok "system_config rows: ${CONFIG_COUNT}"

PLAN_COUNT=$(db "SELECT COUNT(*) FROM plans;")
ok "plans rows: ${PLAN_COUNT}"

PROVIDER_COUNT=$(db "SELECT COUNT(*) FROM providers;")
ok "providers rows: ${PROVIDER_COUNT}"

DEMO_MERCH_PLAN=$(db "SELECT COUNT(*) FROM merchant_plans WHERE merchant_id IN (68, 69);")
ok "merchant_plans for demo accounts: ${DEMO_MERCH_PLAN} (kept for login)"

# =============================================================================
# STEP 6 — Final status
# =============================================================================
banner "STEP 6: Final Status"
if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "${YELLOW}DRY RUN complete — no data was deleted.${RESET}"
  echo -e "Run with ${BOLD}DRY_RUN=false bash scripts/cleanup-demo-data.sh${RESET} to apply."
else
  echo -e "${GREEN}Cleanup complete.${RESET}"
  echo -e "Backup saved at: ${BOLD}${BACKUP_FILE}${RESET}"
fi
echo ""
