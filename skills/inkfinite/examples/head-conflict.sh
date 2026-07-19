#!/usr/bin/env bash
# ==============================================================================
# DESCRIPTION: Reproduces a stale-head rejection, confirms bytes are preserved,
#              then rebuilds and validates a transaction from current heads.
# AUTHOR:      Owais <info@stormlightlabs.org>
# VERSION:     0.0.0
# USAGE:       ./head-conflict.sh DOCUMENT OUTPUT_DIR
# ==============================================================================
set -euo pipefail

CLI="${INKFINITE_CLI:?set INKFINITE_CLI to the inkfinite executable}"
PACKAGE_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
DOC="${1:?usage: head-conflict.sh DOCUMENT OUTPUT_DIR}"
OUTPUT_DIR="${2:?usage: head-conflict.sh DOCUMENT OUTPUT_DIR}"
FIXTURES="${INKFINITE_FIXTURE_DIR:-$PACKAGE_ROOT/fixtures}"

mkdir -p "$OUTPUT_DIR"
INITIAL_INSPECT="$OUTPUT_DIR/conflict-initial-inspect.json"
STALE_TRANSACTION="$OUTPUT_DIR/stale.transaction.json"
CURRENT_INSPECT="$OUTPUT_DIR/conflict-current-inspect.json"
RESOLVED_TRANSACTION="$OUTPUT_DIR/resolved.transaction.json"
BEFORE_STALE_APPLY="$OUTPUT_DIR/before-stale-apply.inkfinite"
AFTER_INTERVENING_EDIT="$OUTPUT_DIR/after-intervening-edit.inkfinite"
STALE_STDOUT="$OUTPUT_DIR/stale.stdout"
STALE_STDERR="$OUTPUT_DIR/stale.stderr"

"$CLI" inspect "$DOC" --json >"$INITIAL_INSPECT"
python3 "$PACKAGE_ROOT/scripts/materialize-transaction.py" \
  --heads "$INITIAL_INSPECT" \
  --template "$FIXTURES/rename-page.transaction.json" \
  --output "$STALE_TRANSACTION"

cp "$DOC" "$BEFORE_STALE_APPLY"
"$CLI" shape patch "$DOC" --shape-id shape:worker \
  --patch '{"properties":{"width":280,"height":100}}' --json >/dev/null
cp "$DOC" "$AFTER_INTERVENING_EDIT"
if cmp -s "$DOC" "$BEFORE_STALE_APPLY"; then
  printf 'intervening edit did not change the document\n' >&2
  exit 1
fi

set +e
"$CLI" apply "$DOC" --transaction "$STALE_TRANSACTION" --json >"$STALE_STDOUT" 2>"$STALE_STDERR"
STATUS=$?
set -e
test "$STATUS" -eq 5
test ! -s "$STALE_STDOUT"
if ! cmp -s "$DOC" "$AFTER_INTERVENING_EDIT"; then
  printf 'stale apply changed the document\n' >&2
  exit 1
fi

"$CLI" inspect "$DOC" --json >"$CURRENT_INSPECT"
"$CLI" query "$DOC" --id shape:worker --json >"$OUTPUT_DIR/conflict-current-query.json"
python3 "$PACKAGE_ROOT/scripts/materialize-transaction.py" \
  --heads "$CURRENT_INSPECT" \
  --template "$FIXTURES/rename-page.transaction.json" \
  --output "$RESOLVED_TRANSACTION"
"$CLI" apply "$DOC" --transaction "$RESOLVED_TRANSACTION" --dry-run --json >/dev/null
"$CLI" apply "$DOC" --transaction "$RESOLVED_TRANSACTION" --json >/dev/null
"$CLI" validate "$DOC" --json >/dev/null

printf 'head-conflict fixture: stale apply rejected; rebuilt transaction committed\n'
