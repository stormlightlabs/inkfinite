#!/usr/bin/env bash
# ==============================================================================
# DESCRIPTION: Drives a live proposal fixture through inspect, narrow query,
#              proposal review, and one-operation partial acceptance.
# AUTHOR:      Owais <info@stormlightlabs.org>
# VERSION:     0.0.0
# USAGE:       INKFINITE_SESSION_ID=session:1 ./proposal-review.sh DOCUMENT OUTPUT_DIR
# ==============================================================================
set -euo pipefail

CLI="${INKFINITE_CLI:?set INKFINITE_CLI to the inkfinite executable}"
PACKAGE_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
DOC="${1:?usage: proposal-review.sh DOCUMENT OUTPUT_DIR}"
OUTPUT_DIR="${2:?usage: proposal-review.sh DOCUMENT OUTPUT_DIR}"
FIXTURES="${INKFINITE_FIXTURE_DIR:-$PACKAGE_ROOT/fixtures}"
SESSION_ARGS=()
if [ -n "${INKFINITE_SESSION_ID:-}" ]; then
  SESSION_ARGS+=(--session-id "$INKFINITE_SESSION_ID")
fi

mkdir -p "$OUTPUT_DIR"
INSPECT="$OUTPUT_DIR/live-inspect.json"
TRANSACTION="$OUTPUT_DIR/proposal.transaction.json"
PROPOSAL="$OUTPUT_DIR/proposal.json"
ACCEPTED="$OUTPUT_DIR/partial-accept.json"

"$CLI" app inspect "${SESSION_ARGS[@]}" --json >"$INSPECT"
"$CLI" app query "${SESSION_ARGS[@]}" --role architecture.service --json >"$OUTPUT_DIR/live-query.json"
python3 "$PACKAGE_ROOT/scripts/materialize-transaction.py" \
  --heads "$INSPECT" \
  --template "$FIXTURES/proposal.transaction.json" \
  --output "$TRANSACTION"

"$CLI" app propose "${SESSION_ARGS[@]}" --transaction "$TRANSACTION" --json >"$PROPOSAL"
PROPOSAL_ID="$(python3 - "$PROPOSAL" <<'PY'
import json
import sys

print(json.load(open(sys.argv[1], encoding="utf-8"))["id"])
PY
)"

"$CLI" app accept "${SESSION_ARGS[@]}" --proposal-id "$PROPOSAL_ID" \
  --operation-position 0 --json >"$ACCEPTED"
"$CLI" app inspect "${SESSION_ARGS[@]}" --json >"$OUTPUT_DIR/live-after-accept.json"

python3 - "$PROPOSAL" "$ACCEPTED" <<'PY'
import json
import sys

proposal = json.load(open(sys.argv[1], encoding="utf-8"))
accepted = json.load(open(sys.argv[2], encoding="utf-8"))
assert len(proposal["transaction"]["operations"]) == 2
assert proposal["preview"]["changed"]
assert accepted["commit"]["transaction_id"] == proposal["transaction"]["id"]
assert accepted["commit"]["patch"]["changed"] == [{"kind": "page", "id": "page:document:agent-skill:1"}]
PY

printf 'proposal fixture: %s partially accepted in %s\n' "$PROPOSAL_ID" "$DOC"
