#!/usr/bin/env bash
# Build shell-manifest.json for the static Next.js export (Vercel / device sync).
# Run after `next build` so hashed assets under out/ are final.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-${ROOT}/apps/shell/out}"

if [[ ! -d "${OUT_DIR}" ]]; then
  echo "Missing export directory: ${OUT_DIR}" >&2
  exit 1
fi

python3 - "${OUT_DIR}" <<'PY'
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

out = Path(sys.argv[1]).resolve()
files: list[dict[str, str]] = []

for path in sorted(out.rglob("*")):
    if not path.is_file():
        continue
    rel = path.relative_to(out).as_posix()
    if rel == "shell-manifest.json":
        continue
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    files.append({"path": f"/{rel}", "sha256": digest})

canonical = "".join(f"{item['path']}:{item['sha256']}\n" for item in files)
version = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
manifest = {
    "version": version,
    "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "files": files,
}
dest = out / "shell-manifest.json"
dest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {dest} ({len(files)} files, version={version[:12]}…)")
PY
