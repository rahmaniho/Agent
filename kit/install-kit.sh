#!/usr/bin/env bash
# install-kit.sh — نصب گزیدهٔ «مهندسی نرم‌افزار، معماری و طراحی سایت» از ECC
# استفاده:
#   ./install-kit.sh [--dest DIR] [--only skills,agents,commands,rules] [--dry-run]
# پیش‌فرض مقصد: ~/.claude
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${HOME}/.claude"
ONLY="skills,agents,commands,rules"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    --dest=*) DEST="${1#*=}"; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --only=*) ONLY="${1#*=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "گزینهٔ ناشناخته: $1" >&2; exit 1 ;;
  esac
done

log() { printf '%s\n' "$*"; }
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] $*"
  else
    "$@"
  fi
}

# کپی امن: فایل/پوشهٔ موجود → .bak (یک‌بار)
copy_item() {
  local src="$1" dst="$2"
  if [ -e "$dst" ] && [ ! -e "${dst}.bak" ]; then
    run cp -R "$dst" "${dst}.bak"
    log "  پشتیبان: ${dst}.bak"
  fi
  run cp -R "$src" "$dst"
}

log "مبدأ:  $KIT_DIR"
log "مقصد:  $DEST"
log "بخش‌ها: $ONLY"
[ "$DRY_RUN" -eq 1 ] && log "حالت:  پیش‌نمایش (هیچ فایلی نوشته نمی‌شود)"
log ""

IFS=',' read -ra PARTS <<< "$ONLY"
for part in "${PARTS[@]}"; do
  part="$(echo "$part" | tr -d ' ')"
  src="$KIT_DIR/$part"
  [ -d "$src" ] || { log "رد شد (وجود ندارد): $part"; continue; }
  log "▸ $part → $DEST/$part"
  run mkdir -p "$DEST/$part"
  for item in "$src"/*; do
    [ -e "$item" ] || continue
    copy_item "$item" "$DEST/$part/$(basename "$item")"
  done
done

# لایسنس و کاتالوگ
run cp "$KIT_DIR/LICENSE-ECC" "$DEST/LICENSE-ECC" 2>/dev/null || true
run cp "$KIT_DIR/CATALOG.md" "$DEST/ECC-KIT-CATALOG.md" 2>/dev/null || true

log ""
if [ "$DRY_RUN" -eq 1 ]; then
  log "پیش‌نمایش تمام شد. برای نصب واقعی بدون --dry-run اجرا کنید."
else
  log "✅ نصب شد در: $DEST"
  log "برای دیدن فهرست مهارت‌ها: $DEST/ECC-KIT-CATALOG.md"
fi
