#!/bin/sh
# install-scanners.sh — Project-local scanner toolchain installer.
# Reads tooling/scanners/manifest.json as single source of truth.
# Verifies exact versions on existing binaries; reinstalls on mismatch.
# Fails closed on any checksum mismatch, download error, or arch mismatch.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec python3 "$SCRIPT_DIR/install_from_manifest.py" "$PROJECT_ROOT"
