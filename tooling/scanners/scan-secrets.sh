#!/bin/sh
# scan-secrets.sh — Secret scanning for git history + non-ignored worktree.
# Delegates snapshot construction to snapshot_worktree.py (NUL-safe, no symlinks).
# Uses `gitleaks git` (current) for history, `gitleaks dir` for worktree snapshot.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BIN_DIR="$PROJECT_ROOT/.tools/bin"
GITLEAKS="$BIN_DIR/gitleaks"
SNAPSHOT_DIR="$PROJECT_ROOT/.tools/_scan_snapshot"

if [ ! -x "$GITLEAKS" ]; then
  echo "[FATAL] gitleaks not found at $GITLEAKS. Run: deno task tools:install" >&2
  exit 1
fi

# shellcheck disable=SC2329
cleanup() {
  rm -rf "$SNAPSHOT_DIR"
}
trap cleanup EXIT

# 1. Prove .env is gitignored by path only (never read)
echo "=== Proving .env is gitignored ==="
if ! git -C "$PROJECT_ROOT" check-ignore -q .env 2>/dev/null; then
  echo "[FATAL] .env is NOT gitignored — refusing to scan" >&2
  exit 1
fi
echo "[ok] .env is gitignored (by path check only)"

# 2. Assert stale stryker-tmp is absent
echo ""
echo "=== Checking stale stryker-tmp ==="
if [ -d "$PROJECT_ROOT/stryker-tmp" ]; then
  echo "[FATAL] stryker-tmp/ exists — stale mutation sandbox. Remove before scanning." >&2
  exit 1
fi
echo "[ok] stryker-tmp absent"

# 3. Build safe snapshot via Python helper (NUL-safe, validates paths)
echo ""
echo "=== Building safe worktree snapshot ==="
python3 "$SCRIPT_DIR/snapshot_worktree.py" "$PROJECT_ROOT" "$SNAPSHOT_DIR"

# 4. Scan snapshot with gitleaks dir + redaction
echo ""
echo "=== Gitleaks worktree scan (non-ignored files only) ==="
worktree_exit=0
"$GITLEAKS" dir "$SNAPSHOT_DIR" --redact --verbose 2>&1 || worktree_exit=$?

# 5. Scan git history with redaction (current command, not deprecated detect)
echo ""
echo "=== Gitleaks git history scan ==="
history_exit=0
"$GITLEAKS" git "$PROJECT_ROOT" --redact --verbose 2>&1 || history_exit=$?

# 6. Report
echo ""
echo "=== Secret scan results ==="
echo "Git history scan: exit $history_exit"
echo "Worktree scan:    exit $worktree_exit"

if [ "$history_exit" -ne 0 ] || [ "$worktree_exit" -ne 0 ]; then
  echo ""
  echo "[FAIL] Secret scan found leaks. See output above."
  exit 1
fi

echo ""
echo "[ok] No leaks found in git history or non-ignored worktree."
exit 0
