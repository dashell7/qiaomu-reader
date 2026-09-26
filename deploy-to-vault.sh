#!/usr/bin/env bash
# Build the plugin and install it into the Obsidian vault, keeping a timestamped
# backup of whatever was there before. Run from anywhere.
#
#   ./deploy-to-vault.sh          # production build, then deploy
#   ./deploy-to-vault.sh --no-build   # deploy the existing build output as-is
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT="/f/qiaomu-reader-english"
PLUGIN_DIR="$VAULT/.obsidian/plugins/qiaomu-reader-english"
BACKUP_ROOT="$VAULT/.obsidian/plugin-test-backups"

if [[ "${1:-}" != "--no-build" ]]; then
  echo "==> building"
  (cd "$REPO" && npm run build)
fi

for f in main.js styles.css manifest.json; do
  [[ -f "$REPO/$f" ]] || { echo "missing build output: $REPO/$f" >&2; exit 1; }
done

if [[ -d "$PLUGIN_DIR" ]]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  DEST="$BACKUP_ROOT/qiaomu-reader-english-$STAMP"
  echo "==> backing up to $DEST"
  mkdir -p "$DEST"
  for f in main.js styles.css manifest.json data.json; do
    [[ -f "$PLUGIN_DIR/$f" ]] && cp "$PLUGIN_DIR/$f" "$DEST/"
  done
else
  echo "==> no existing install, creating $PLUGIN_DIR"
  mkdir -p "$PLUGIN_DIR"
fi

echo "==> deploying"
for f in main.js styles.css manifest.json; do
  cp "$REPO/$f" "$PLUGIN_DIR/$f"
done

# Keep only the ten most recent backups.
ls -1dt "$BACKUP_ROOT"/qiaomu-reader-english-* 2>/dev/null | tail -n +11 | while read -r old; do
  rm -rf "$old"
done

echo "==> done: $PLUGIN_DIR"
ls -la "$PLUGIN_DIR"
