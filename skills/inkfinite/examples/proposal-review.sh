#!/usr/bin/env bash
# ==============================================================================
# DESCRIPTION: Drives a live proposal fixture through inspect, narrow query,
#              proposal creation, and review-status polling.
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
STATUS="$OUTPUT_DIR/proposal-status.json"

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

"$CLI" app proposal status "${SESSION_ARGS[@]}" --proposal-id "$PROPOSAL_ID" --json >"$STATUS"
"$CLI" app inspect "${SESSION_ARGS[@]}" --json >"$OUTPUT_DIR/live-after-accept.json"

python3 - "$PROPOSAL" "$STATUS" <<'PY'
import json
import sys

proposal = json.load(open(sys.argv[1], encoding="utf-8"))
status = json.load(open(sys.argv[2], encoding="utf-8"))
assert len(proposal["transaction"]["operations"]) == 2
assert proposal["preview"]["changed"]
assert status["proposal_id"] == proposal["id"]
assert status["state"] == "accepted"
PY

printf 'proposal fixture: %s reviewed in %s\n' "$PROPOSAL_ID" "$DOC"
