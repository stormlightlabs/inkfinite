#!/usr/bin/env bash
# ==============================================================================
# DESCRIPTION: Builds a semantic Inkfinite board, exercises structured edits,
#              and verifies dry-run, validation, query, and SVG output paths.
# AUTHOR:      Owais <info@stormlightlabs.org>
# VERSION:     0.0.0
# USAGE:       ./file-mode.sh OUTPUT_DIR
# ==============================================================================
set -euo pipefail

CLI="${INKFINITE_CLI:?set INKFINITE_CLI to the inkfinite executable}"
OUTPUT_DIR="${1:?usage: file-mode.sh OUTPUT_DIR}"

mkdir -p "$OUTPUT_DIR"
DOC="$OUTPUT_DIR/board.inkfinite"
SVG="$OUTPUT_DIR/services.svg"

"$CLI" new "$DOC" --document-id document:agent-skill --page-name Architecture --json >/dev/null
LAYER="layer:document:agent-skill:1"

"$CLI" shape create "$DOC" \
	--shape-id shape:api --kind rect --layer "$LAYER" --x 80 --y 100 \
	--properties '{"width":180,"height":90}' --name API --role architecture.service \
	--tag backend --json >/dev/null
"$CLI" shape create "$DOC" \
	--shape-id shape:worker --kind rect --layer "$LAYER" --x 360 --y 180 \
	--properties '{"width":180,"height":90}' --name Worker --role architecture.service \
	--tag backend --json >/dev/null
"$CLI" shape create "$DOC" \
	--shape-id shape:queue --kind rect --layer "$LAYER" --x 520 --y 280 \
	--properties '{"width":180,"height":90}' --name Queue --role architecture.service \
	--tag backend --json >/dev/null
"$CLI" shape create "$DOC" \
	--shape-id shape:database --kind ellipse --layer "$LAYER" --x 680 --y 100 \
	--properties '{"width":160,"height":90}' --name Database --role architecture.database \
	--tag storage --json >/dev/null
"$CLI" shape create "$DOC" \
	--shape-id shape:arrow --kind arrow --layer "$LAYER" --x 0 --y 0 \
	--properties '{"width":1,"height":1}' --name Connector --role architecture.connector \
	--json >/dev/null
"$CLI" shape create "$DOC" \
	--shape-id shape:review-only --kind rect --layer "$LAYER" --x 80 --y 340 \
	--properties '{"width":220,"height":70}' --name 'Review only' --role review.annotation \
	--locked --agent-editable false --json >/dev/null

"$CLI" shape patch "$DOC" --name API \
	--patch '{"properties":{"width":220,"height":100}}' --json >/dev/null

DRY_RUN="$OUTPUT_DIR/dry-run.json"
"$CLI" shape patch "$DOC" --shape-id shape:worker \
	--patch '{"transform":{"translation":{"x":360,"y":220},"rotation":0,"scale_x":1,"scale_y":1}}' \
	--dry-run --json >"$DRY_RUN"
python3 - "$DRY_RUN" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
assert result["dry_run"] is True
assert result["updated"] == [{"kind": "shape", "id": "shape:worker"}]
PY

"$CLI" layout align "$DOC" --role architecture.service --alignment top --json >/dev/null
"$CLI" layout distribute "$DOC" --role architecture.service --axis horizontal --json >/dev/null
"$CLI" connect "$DOC" --binding-id binding:service-database \
	--source-role architecture.connector --target-role architecture.database --json >/dev/null

QUERY="$OUTPUT_DIR/query.json"
"$CLI" query "$DOC" --role architecture.service --layer "$LAYER" --json >"$QUERY"
python3 - "$QUERY" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
ids = [record["id"] for record in result["records"]]
assert ids == ["shape:api", "shape:queue", "shape:worker"], ids
assert result["heads"]
PY

"$CLI" validate "$DOC" --json >/dev/null
"$CLI" render "$DOC" --output "$SVG" --role architecture.service --json >/dev/null
test -s "$SVG"

printf 'file-mode fixture: %s\n' "$DOC"
