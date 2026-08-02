#!/usr/bin/env bash
# ==============================================================================
# DESCRIPTION: Installs the bundled skill into a temporary directory and runs
#              its CLI, schema, file-mode, proposal, and conflict fixtures.
# AUTHOR:      Owais <info@stormlightlabs.org>
# VERSION:     0.0.0
# USAGE:       INKFINITE_CLI=/path/to/inkfinite ./verify-examples.sh
# ==============================================================================
set -euo pipefail

PACKAGE_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
REPOSITORY_ROOT="$(CDPATH='' cd -- "$PACKAGE_ROOT/../.." && pwd)"

if [ -n "${INKFINITE_CLI:-}" ]; then
	CLI="$INKFINITE_CLI"
elif command -v inkfinite >/dev/null 2>&1; then
	CLI="$(command -v inkfinite)"
elif [ -x "$REPOSITORY_ROOT/target/debug/inkfinite" ]; then
	CLI="$REPOSITORY_ROOT/target/debug/inkfinite"
else
	if ! command -v cargo >/dev/null 2>&1; then
		printf 'set INKFINITE_CLI to an inkfinite executable\n' >&2
		exit 2
	fi
	cargo build -p inkfinite-cli --bin inkfinite
	CLI="$REPOSITORY_ROOT/target/debug/inkfinite"
fi

RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/inkfinite-agent-verify.XXXXXX")"
RUNTIME_DIR="$(mktemp -d /tmp/inkfinite-agent-runtime.XXXXXX)"
SERVER_PID=""
cleanup() {
	if [ -n "$SERVER_PID" ]; then
		kill "$SERVER_PID" 2>/dev/null || true
		wait "$SERVER_PID" 2>/dev/null || true
	fi
	rm -rf "$RUN_DIR" "$RUNTIME_DIR"
}
trap cleanup EXIT
INSTALLED_ROOT="$RUN_DIR/installed-skill"
cp -R "$PACKAGE_ROOT" "$INSTALLED_ROOT"
FIXTURE_DIR="$INSTALLED_ROOT/fixtures"
export INKFINITE_CLI="$CLI"
export INKFINITE_FIXTURE_DIR="$FIXTURE_DIR"

"$CLI" --help >"$RUN_DIR/help.txt"
"$CLI" capabilities --json >"$RUN_DIR/capabilities.json"
"$CLI" schema document >"$RUN_DIR/document.schema.json"
"$CLI" schema transaction >"$RUN_DIR/transaction.schema.json"
"$CLI" schema protocol >"$RUN_DIR/protocol.schema.json"
python3 - "$RUN_DIR/capabilities.json" "$RUN_DIR/document.schema.json" "$RUN_DIR/transaction.schema.json" "$RUN_DIR/protocol.schema.json" <<'PY'
import json
import sys

capabilities = json.load(open(sys.argv[1], encoding="utf-8"))
assert {"inspect", "query", "apply", "connect", "layout", "render", "schema"}.issubset(capabilities["commands"])
assert capabilities["live_mode"]["proposal_review"] is True
assert capabilities["live_mode"]["agent_access_modes"] == ["review", "direct"]
assert capabilities["live_mode"]["agent_access_is_session_scoped"] is True
assert capabilities["live_mode"]["agent_access_is_desktop_controlled"] is True
for path in sys.argv[2:]:
    assert isinstance(json.load(open(path, encoding="utf-8")), dict), path
PY

bash "$INSTALLED_ROOT/examples/file-mode.sh" "$RUN_DIR/file-mode"

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export USER=inkfinite-agent-fixture
SERVER_READY="$RUN_DIR/server.ready"

# The file-mode example only needs its final document; inspect it before the
# fixture server starts so the server can return a valid DocumentSnapshot.
"$CLI" inspect "$RUN_DIR/file-mode/board.inkfinite" --json >"$RUN_DIR/file-mode/board-inspect.json"

python3 "$INSTALLED_ROOT/scripts/live-fixture-server.py" \
	--snapshot "$RUN_DIR/file-mode/board-inspect.json" \
	--ready "$SERVER_READY" \
	--requests 5 \
	>"$RUN_DIR/live-server.log" 2>&1 &
SERVER_PID=$!
until test -f "$SERVER_READY"; do
	if ! kill -0 "$SERVER_PID" 2>/dev/null; then
		cat "$RUN_DIR/live-server.log" >&2
		exit 1
	fi
	sleep 0.05
done

export INKFINITE_SESSION_ID=session:fixture
bash "$INSTALLED_ROOT/examples/proposal-review.sh" "$RUN_DIR/file-mode/board.inkfinite" "$RUN_DIR/proposal"
wait "$SERVER_PID"

bash "$INSTALLED_ROOT/examples/head-conflict.sh" \
	"$RUN_DIR/file-mode/board.inkfinite" "$RUN_DIR/head-conflict"

printf 'Inkfinite agent skill examples passed in %s\n' "$RUN_DIR"
