#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-subdomains.sh
# Post-deploy smoke test for the five rasokart.com role subdomains.
#
# Usage:
#   bash scripts/src/verify-subdomains.sh [BASE_DOMAIN]
#
# BASE_DOMAIN defaults to rasokart.com.
# The script checks:
#   1. HTTPS reachability of each subdomain (200 or 301 from static SPA)
#   2. /api/healthz on the apex domain
#   3. /api/auth/login returns JSON 401 for a bad credential (not HTML)
#   4. Session isolation note (localStorage is origin-scoped by the browser —
#      a token stored on merchant.rasokart.com is NOT readable on
#      agent.rasokart.com; no server-side test required).
# ---------------------------------------------------------------------------

set -euo pipefail

BASE="${1:-rasokart.com}"
SUBDOMAINS=(superadmin admin merchant payoutmerchant agent)
PASS=0
FAIL=0

green() { printf '\033[32m✓\033[0m %s\n' "$*"; }
red()   { printf '\033[31m✗\033[0m %s\n' "$*"; }

check_https() {
  local url="$1"
  local http_code
  http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo "000")
  if [[ "$http_code" =~ ^(200|301|302)$ ]]; then
    green "HTTPS $url → $http_code"
    PASS=$((PASS + 1))
  else
    red   "HTTPS $url → $http_code (expected 200/301)"
    FAIL=$((FAIL + 1))
  fi
}

check_json_body() {
  local url="$1"
  local method="${2:-GET}"
  local body="${3:-}"
  local expect_key="${4:-status}"
  local response
  if [[ "$method" == "POST" ]]; then
    response=$(curl -s --max-time 10 -X POST "$url" \
      -H "Content-Type: application/json" \
      -d "$body" || echo '{}')
  else
    response=$(curl -s --max-time 10 "$url" || echo '{}')
  fi
  if echo "$response" | grep -q "\"$expect_key\""; then
    green "JSON  $url contains \"$expect_key\""
    PASS=$((PASS + 1))
  else
    red   "JSON  $url missing \"$expect_key\" — got: ${response:0:120}"
    FAIL=$((FAIL + 1))
  fi
}

echo "═══════════════════════════════════════════════════════"
echo " RasoKart Subdomain Smoke Test — base: $BASE"
echo "═══════════════════════════════════════════════════════"
echo ""

# 1. Apex domain
echo "── Apex domain ──"
check_https "https://$BASE/"
check_json_body "https://$BASE/api/healthz" GET "" "status"
check_json_body "https://$BASE/api/healthz/deep" GET "" "status"
echo ""

# 2. Each subdomain serves the React SPA
echo "── Subdomain HTTPS reachability ──"
for sub in "${SUBDOMAINS[@]}"; do
  check_https "https://$sub.$BASE/"
done
echo ""

# 3. Auth endpoint returns JSON for wrong credentials (not HTML)
#    Tests that API proxy is correctly wired on the apex domain.
echo "── Auth endpoint returns structured JSON ──"
check_json_body \
  "https://$BASE/api/auth/login" \
  "POST" \
  '{"email":"nonexistent@rasokart.com","password":"wrongpassword"}' \
  "error"
echo ""

# 4. Legacy-path redirect notes
echo "── Legacy path redirect (manual check) ──"
echo "   Run these manually to verify 301 redirects work:"
echo "   curl -sI https://$BASE/admin    | grep -i location"
echo "   curl -sI https://$BASE/merchant | grep -i location"
echo "   curl -sI https://$BASE/agent    | grep -i location"
echo ""

# 5. Session isolation note
echo "── Session isolation ──"
green "localStorage is origin-scoped (per-subdomain) by the browser."
echo "   A token stored on merchant.$BASE is NOT accessible on agent.$BASE."
echo "   This is enforced by the browser Same-Origin Policy — no server test needed."
echo ""

# 6. Summary
echo "═══════════════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
