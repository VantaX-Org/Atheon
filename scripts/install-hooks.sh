#!/usr/bin/env bash
# Install Atheon git hooks into the local clone.
#
# Copies scripts/git-hooks/* into .git/hooks/ and marks them executable.
# Does NOT modify git config (no core.hooksPath change) — repo policy
# forbids touching git config. To uninstall, just delete the files in
# .git/hooks/ directly.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
src_dir="$repo_root/scripts/git-hooks"
dst_dir="$repo_root/.git/hooks"

if [ ! -d "$src_dir" ]; then
  echo "❌ Source hooks dir missing: $src_dir" >&2
  exit 1
fi

mkdir -p "$dst_dir"

count=0
for hook in "$src_dir"/*; do
  [ -f "$hook" ] || continue
  name="$(basename "$hook")"
  cp "$hook" "$dst_dir/$name"
  chmod +x "$dst_dir/$name"
  echo "  ✓ installed $name"
  count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
  echo "⚠️  No hook files found in $src_dir"
  exit 0
fi

echo
echo "✅ Installed $count hook(s) into $dst_dir"
echo "   To uninstall: rm $dst_dir/<hook-name>"
