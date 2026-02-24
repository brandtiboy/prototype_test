#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Deploy a prototype to Vercel with one command
#
# Usage:
#   ./deploy.sh                  → deploy the whole prototype-tester folder
#   ./deploy.sh event-management → deploy only that prototype (uses sub-folder)
#
# On first run, Vercel will ask you to log in. After that it's instant.
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}"

# ── Check for Node / npm ─────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo "❌  Node.js is required but not found."
  echo "    Install it from https://nodejs.org (LTS version recommended)"
  echo ""
  exit 1
fi

# ── Install Vercel CLI if missing ────────────────────────────────────────────
if ! command -v vercel &>/dev/null; then
  echo "📦  Installing Vercel CLI (one-time setup)…"
  npm install -g vercel
  echo "✅  Vercel CLI installed."
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
echo ""
echo "🚀  Deploying $(basename "$TARGET") to Vercel…"
echo ""

cd "$TARGET"
DEPLOY_URL=$(vercel deploy --prod --yes 2>&1 | tail -n 1)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅  Deployed!"
echo ""
echo "   Prototype URL → $DEPLOY_URL"
echo "   Results dashboard → $DEPLOY_URL/results-dashboard.html"
echo ""
echo "   Share the prototype URL with testers."
echo "   Open the Results dashboard URL yourself (add your Supabase key once)."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
