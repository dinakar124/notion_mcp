#!/usr/bin/env python3
"""snapshot_worktree.py — Build a safe snapshot of non-ignored worktree files.

Consumes raw NUL-delimited output from `git ls-files -co --exclude-standard -z`.
- Uses os.fsdecode on raw bytes for safe filename handling (including newlines).
- FATAL on any non-ignored symlink or non-regular file — the scan can never
  silently omit a repository path.
- Validates every resolved destination stays under the snapshot root.
- Rejects credential-path patterns that should never be committed.
- Never reads or prints file contents.
"""

import os
import shutil
import subprocess
import sys


CREDENTIAL_EXTENSIONS = frozenset({".pem", ".key", ".p12", ".pfx"})


def fatal(msg: str) -> None:
    print(f"[FATAL] {msg}", file=sys.stderr)
    sys.exit(1)


def is_credential_path(relpath: str) -> bool:
    """Return True if the path matches a credential pattern that should
    never appear in the non-ignored set."""
    basename = os.path.basename(relpath)
    if basename.startswith(".env") and basename != ".env.example":
        return True
    parts = relpath.replace("\\", "/").split("/")
    if "secrets" in parts:
        return True
    _, ext = os.path.splitext(basename)
    if ext.lower() in CREDENTIAL_EXTENSIONS:
        return True
    return False


def main() -> None:
    if len(sys.argv) != 3:
        fatal("Usage: snapshot_worktree.py <project_root> <snapshot_dir>")

    project_root = os.path.realpath(sys.argv[1])
    snapshot_dir = os.path.realpath(sys.argv[2])

    if not os.path.isdir(project_root):
        fatal(f"Project root is not a directory: {project_root}")

    result = subprocess.run(
        ["git", "-C", project_root, "ls-files", "-co", "--exclude-standard", "-z"],
        capture_output=True,
    )
    if result.returncode != 0:
        fatal(
            f"git ls-files failed: "
            f"{result.stderr.decode('utf-8', errors='replace')}"
        )

    raw = result.stdout
    if not raw:
        fatal("git ls-files returned empty output")

    entries = raw.split(b"\x00")
    paths: list[str] = []
    for entry in entries:
        if not entry:
            continue
        try:
            decoded = os.fsdecode(entry)
        except (UnicodeDecodeError, ValueError) as e:
            fatal(f"Cannot decode filename: {entry!r} — {e}")
        paths.append(decoded)

    # Reject credential paths
    credential_violations = [p for p in paths if is_credential_path(p)]
    if credential_violations:
        fatal(
            "Credential paths found in non-ignored file set:\n"
            + "\n".join(f"  {v}" for v in credential_violations)
        )

    # Clean and create snapshot directory
    if os.path.exists(snapshot_dir):
        shutil.rmtree(snapshot_dir)
    os.makedirs(snapshot_dir, exist_ok=True)
    snapshot_real = os.path.realpath(snapshot_dir)

    copied = 0
    for relpath in paths:
        src = os.path.join(project_root, relpath)

        # FATAL on symlinks — scan must never silently omit a path
        if os.path.islink(src):
            fatal(f"Non-ignored symlink: {relpath} — resolve or gitignore it")

        # FATAL on non-regular files (directories listed by git are rare
        # but pipes/sockets/devices must not be silently skipped)
        if not os.path.isfile(src):
            fatal(f"Non-regular non-ignored file: {relpath} — resolve or gitignore it")

        # Validate destination stays under snapshot root
        dest = os.path.join(snapshot_dir, relpath)
        dest_norm = os.path.normpath(dest)
        if (
            not dest_norm.startswith(snapshot_real + os.sep)
            and dest_norm != snapshot_real
        ):
            fatal(f"Path escapes snapshot root: {relpath} -> {dest_norm}")

        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(src, dest, follow_symlinks=False)
        copied += 1

    print(f"[ok] Snapshot: {copied} files copied")


if __name__ == "__main__":
    main()
