#!/usr/bin/env python3
"""install_from_manifest.py — Project-local scanner toolchain installer.

Reads tooling/scanners/manifest.json as the SINGLE SOURCE OF TRUTH.
- Existing binary acceptance requires BOTH exact boundary-aware version
  AND exact binary SHA-256.
- Candidate acceptance also requires both before atomic os.replace.
- Validates URL scheme=https and trusted GitHub release host.
- Fails closed on any mismatch.
"""

import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from urllib.parse import urlparse

TRUSTED_HOSTS = frozenset({"github.com"})


def fatal(msg: str) -> None:
    print(f"[FATAL] {msg}", file=sys.stderr)
    sys.exit(1)


def check_arch(manifest_arch: str) -> None:
    machine = platform.machine().lower()
    system = platform.system().lower()
    normalized = f"{system}_{machine}".replace("aarch64", "arm64")
    if normalized != manifest_arch:
        fatal(f"Architecture mismatch: host={normalized}, manifest={manifest_arch}")


def validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        fatal(f"URL scheme must be https, got: {parsed.scheme} in {url}")
    if parsed.hostname not in TRUSTED_HOSTS:
        fatal(f"URL host {parsed.hostname} not in trusted set {TRUSTED_HOSTS}")
    if "/releases/download/" not in parsed.path:
        fatal(f"URL path does not look like a GitHub release: {url}")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def version_match_exact(output: str, version_match: str) -> bool:
    """Boundary-aware: version must appear as a complete token."""
    pattern = (
        r"(?<![0-9a-zA-Z.])" + re.escape(version_match) + r"(?![0-9a-zA-Z.])"
    )
    return bool(re.search(pattern, output))


def check_version(bin_path: str, version_cmd: str, version_match: str) -> bool:
    """Return True if binary reports the exact expected version."""
    if not os.path.isfile(bin_path) or not os.access(bin_path, os.X_OK):
        return False
    try:
        result = subprocess.run(
            [bin_path, version_cmd],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return version_match_exact(result.stdout + result.stderr, version_match)
    except (subprocess.TimeoutExpired, OSError):
        return False


def verify_binary(bin_path: str, tool: dict) -> bool:
    """Full verification: version match AND binary SHA-256 match."""
    if not check_version(bin_path, tool["version_cmd"], tool["version_match"]):
        return False
    if "binary_sha256" in tool:
        actual = sha256_file(bin_path)
        if actual != tool["binary_sha256"]:
            return False
    return True


def download_file(url: str, dest: str) -> None:
    print(f"  Downloading {url}")
    urllib.request.urlretrieve(url, dest)


def extract_binary(archive_path: str, binary_name: str, extract_dir: str) -> str:
    with tarfile.open(archive_path, "r:gz") as tf:
        for member in tf.getmembers():
            if member.name.startswith("/") or ".." in member.name:
                fatal(f"Unsafe path in archive: {member.name}")
        tf.extractall(extract_dir, filter="data")
    for root, _dirs, files in os.walk(extract_dir):
        if binary_name in files:
            candidate = os.path.join(root, binary_name)
            if os.path.isfile(candidate):
                return candidate
    fatal(f"Binary '{binary_name}' not found in archive")
    return ""


def install_tool(name: str, tool: dict, bin_dir: str, tmp_dir: str) -> str:
    """Install or verify one tool. Returns 'verified' or 'installed'.

    Existing acceptance: version + binary SHA.
    Candidate acceptance: version + binary SHA, then atomic os.replace.
    On any failure the old binary is preserved."""
    binary_name = tool["binary"]
    version = tool["version"]
    bin_path = os.path.join(bin_dir, binary_name)

    # Accept existing if BOTH version and binary hash match
    if os.path.isfile(bin_path) and verify_binary(bin_path, tool):
        print(f"[ok]   {name} {version} — version + SHA verified")
        return "verified"

    if os.path.exists(bin_path):
        print(f"[stale] {name} — version or SHA mismatch, replacing atomically")
    else:
        print(f"[new]  {name} {version}")

    validate_url(tool["url"])
    print(f"[fetch] {name} {version}")

    archive_path = os.path.join(tmp_dir, f"{name}.tar.gz")
    download_file(tool["url"], archive_path)

    # Verify archive SHA
    actual_archive_sha = sha256_file(archive_path)
    if actual_archive_sha != tool["sha256"]:
        os.remove(archive_path)
        fatal(
            f"{name} archive SHA-256 mismatch!\n"
            f"  expected: {tool['sha256']}\n"
            f"  actual:   {actual_archive_sha}"
        )
    print(f"  Archive SHA verified: {actual_archive_sha}")

    # Extract
    extract_dir = os.path.join(tmp_dir, f"{name}_extract")
    os.makedirs(extract_dir, exist_ok=True)
    found = extract_binary(archive_path, binary_name, extract_dir)

    # Stage candidate
    candidate_path = os.path.join(tmp_dir, f"{binary_name}.candidate")
    shutil.copy2(found, candidate_path)
    os.chmod(candidate_path, 0o755)

    # Verify candidate: version + binary SHA
    if not verify_binary(candidate_path, tool):
        # Diagnose which check failed
        ver_ok = check_version(
            candidate_path, tool["version_cmd"], tool["version_match"]
        )
        sha_ok = (
            sha256_file(candidate_path) == tool.get("binary_sha256", "")
            if "binary_sha256" in tool
            else True
        )
        os.remove(candidate_path)
        fatal(
            f"{name} candidate verification failed "
            f"(version={'ok' if ver_ok else 'FAIL'}, "
            f"sha={'ok' if sha_ok else 'FAIL'}); old binary preserved"
        )

    print(f"  Candidate binary SHA verified: {sha256_file(candidate_path)}")

    # Atomic replace
    os.replace(candidate_path, bin_path)
    print(f"[ok]   {name} {version} installed to {bin_path}")

    shutil.rmtree(extract_dir, ignore_errors=True)
    if os.path.exists(archive_path):
        os.remove(archive_path)

    return "installed"


def main() -> None:
    if len(sys.argv) != 2:
        fatal("Usage: install_from_manifest.py <project_root>")

    project_root = sys.argv[1]
    manifest_path = os.path.join(
        project_root, "tooling", "scanners", "manifest.json"
    )
    if not os.path.isfile(manifest_path):
        fatal(f"Manifest not found: {manifest_path}")

    with open(manifest_path) as f:
        manifest = json.load(f)

    check_arch(manifest["arch"])

    bin_dir = os.path.join(project_root, manifest["install_prefix"])
    tmp_dir = os.path.join(project_root, ".tools", "_download_tmp")
    os.makedirs(bin_dir, exist_ok=True)
    os.makedirs(tmp_dir, exist_ok=True)

    print("=== Scanner Toolchain Installer ===")
    print(f"Manifest: {manifest_path}")
    print(f"Install prefix: {bin_dir}")
    print(f"Architecture: {manifest['arch']}")
    print()

    results: dict[str, str] = {}
    for name, tool in manifest["tools"].items():
        results[name] = install_tool(name, tool, bin_dir, tmp_dir)

    # Final verification — both version and SHA
    print()
    print("=== Final verification ===")
    all_ok = True
    for name, tool in manifest["tools"].items():
        bin_path = os.path.join(bin_dir, tool["binary"])
        if verify_binary(bin_path, tool):
            print(f"[ok]   {name} {tool['version']}")
        else:
            print(f"[FAIL] {name} — version or SHA mismatch")
            all_ok = False

    if not all_ok:
        fatal("Not all binaries verified. Aborting.")

    shutil.rmtree(tmp_dir, ignore_errors=True)

    print()
    ic = sum(1 for v in results.values() if v == "installed")
    vc = sum(1 for v in results.values() if v == "verified")
    print(f"All {len(results)} scanner binaries verified. ({ic} installed, {vc} already present)")


if __name__ == "__main__":
    main()
