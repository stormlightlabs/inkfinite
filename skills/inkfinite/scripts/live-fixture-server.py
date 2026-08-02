#!/usr/bin/env python3
"""
==============================================================================
DESCRIPTION: Serves an authenticated Unix-socket test double for the Inkfinite
             CLI proposal and review-status example.
AUTHOR:      Owais <info@stormlightlabs.org>
VERSION:     0.0.0
USAGE:       python3 live-fixture-server.py --snapshot SNAPSHOT --ready READY
==============================================================================

Serve a small authenticated Unix-socket double for CLI proposal tests.

This process exercises the real CLI framing, discovery, request decoding, and
response decoding. It is intentionally not a desktop implementation and never
touches the canonical document.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import struct
from copy import deepcopy
from pathlib import Path
from typing import Any


PROTOCOL_ID = "inkfinite.protocol"
PROTOCOL_VERSION = 3
SESSION_ID = "session:fixture"
TOKEN = "inkfinite-agent-fixture-token"


def user_component() -> str:
    raw = os.environ.get("USER") or os.environ.get("USERNAME") or "user"
    value = re.sub(r"[^A-Za-z0-9_-]", "", raw)[:32]
    return value or "user"


def read_exact(stream: socket.socket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = stream.recv(size - len(chunks))
        if not chunk:
            raise RuntimeError("truncated IPC fixture frame")
        chunks.extend(chunk)
    return bytes(chunks)


def read_frame(stream: socket.socket) -> dict[str, Any]:
    size = struct.unpack(">I", read_exact(stream, 4))[0]
    if size > 1024 * 1024:
        raise RuntimeError("fixture frame is too large")
    return json.loads(read_exact(stream, size))


def write_frame(stream: socket.socket, value: dict[str, Any]) -> None:
    payload = json.dumps(value, separators=(",", ":")).encode("utf-8")
    stream.sendall(struct.pack(">I", len(payload)) + payload)


def record_ids(operations: list[dict[str, Any]]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for operation in operations:
        kind = operation["type"]
        if kind == "rename_page":
            result.append({"kind": "page", "id": operation["page_id"]})
        elif kind in {"patch_shape", "reparent_shape", "delete_shape"}:
            result.append({"kind": "shape", "id": operation["shape_id"]})
        elif kind == "create_shape":
            result.append({"kind": "shape", "id": operation["shape"]["id"]})
        elif kind == "create_binding":
            result.append({"kind": "binding", "id": operation["binding"]["id"]})
        elif kind == "delete_binding":
            result.append({"kind": "binding", "id": operation["binding_id"]})
        elif kind in {"align_shapes", "distribute_shapes"}:
            result.extend(
                {"kind": "shape", "id": shape_id} for shape_id in operation["shape_ids"]
            )
    unique: list[dict[str, str]] = []
    for value in result:
        if value not in unique:
            unique.append(value)
    return unique


def query_records(snapshot: dict[str, Any], role: str | None) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for shape_id, shape in snapshot["document"]["shapes"].items():
        if role is None or shape["metadata"].get("role") == role:
            records.append({"kind": "shape", "id": shape_id})
    return records


def apply_operations(
    snapshot: dict[str, Any], operations: list[dict[str, Any]]
) -> None:
    for operation in operations:
        if operation["type"] == "rename_page":
            page = snapshot["document"]["pages"][operation["page_id"]]
            page["name"] = operation["name"]
        elif operation["type"] == "patch_shape":
            shape = snapshot["document"]["shapes"][operation["shape_id"]]
            for field, value in operation["patch"].get("properties", {}).items():
                shape["properties"][field] = value


def status(snapshot: dict[str, Any], dirty: bool) -> dict[str, Any]:
    return {
        "session_id": SESSION_ID,
        "path": "fixture.inkfinite",
        "actor_id": "actor:inkfinite-agent",
        "snapshot": snapshot,
        "dirty": dirty,
        "lock_held": True,
        "recovery_available": False,
        "can_undo": dirty,
        "can_redo": False,
        "sync": {"status": "disabled"},
    }


def response_for(
    request: dict[str, Any],
    snapshot: dict[str, Any],
    proposal: dict[str, Any] | None,
    sequence: int,
) -> tuple[dict[str, Any], dict[str, Any] | None, int]:
    command = request["request"]
    command_type = command["type"]
    if command_type == "inspect":
        return {"type": "snapshot", "value": snapshot}, proposal, sequence
    if command_type == "query":
        role = command["query"].get("role")
        result = {
            "heads": snapshot["heads"],
            "records": query_records(snapshot, role),
            "bounds": {},
            "details": [],
            "total": len(query_records(snapshot, role)),
            "truncated": False,
        }
        return {"type": "query_result", "value": result}, proposal, sequence
    if command_type == "propose":
        transaction = command["transaction"]
        changed = record_ids(transaction["operations"])
        proposal = {
            "id": "proposal:fixture",
            "transaction": transaction,
            "preview": {"created": [], "changed": changed, "deleted": []},
            "affected_regions": [],
            "warnings": [],
            "expires_at": 4102444800000,
        }
        # The fixture simulates a human accepting the first operation in the
        # desktop UI. Agent-facing IPC can observe this decision but cannot
        # make it.
        apply_operations(snapshot, transaction["operations"][:1])
        sequence += 1
        snapshot["heads"] = [f"fixture-head-{sequence}"]
        return {"type": "proposal", "value": proposal}, proposal, sequence
    if command_type == "proposal_status":
        if proposal is None or command["proposal_id"] != proposal["id"]:
            raise RuntimeError("fixture received an unknown proposal")
        return (
            {
                "type": "proposal_status",
                "value": {
                    "proposal_id": proposal["id"],
                    "state": "accepted",
                    "heads": snapshot["heads"],
                    "proposal": None,
                },
            },
            proposal,
            sequence,
        )
    raise RuntimeError(f"fixture does not implement app command {command_type}")


def main() -> int:
    if os.name == "nt":
        raise SystemExit("live fixture server requires Unix-domain sockets")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--requests", type=int, default=5)
    parser.add_argument("--ready", type=Path, required=True)
    args = parser.parse_args()

    runtime = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp"))
    directory = runtime / f"inkfinite-{user_component()}"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    endpoint = directory / "control.sock"
    discovery_path = directory / "ipc.json"
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    discovery = {
        "protocol_id": PROTOCOL_ID,
        "version": PROTOCOL_VERSION,
        "endpoint": str(endpoint),
        "token": TOKEN,
    }
    endpoint.unlink(missing_ok=True)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(str(endpoint))
    sock.listen(1)
    discovery_path.write_text(json.dumps(discovery), encoding="utf-8")
    args.ready.write_text("ready\n", encoding="utf-8")

    proposal: dict[str, Any] | None = None
    sequence = 0
    try:
        for _ in range(args.requests):
            connection, _ = sock.accept()
            with connection:
                request = read_frame(connection)
                if (
                    request["protocol_id"] != PROTOCOL_ID
                    or request["version"] != PROTOCOL_VERSION
                ):
                    raise RuntimeError("fixture received an unsupported protocol")
                if request["token"] != TOKEN:
                    raise RuntimeError("fixture received an invalid token")
                result, proposal, sequence = response_for(
                    request, snapshot, proposal, sequence
                )
                write_frame(
                    connection,
                    {"request_id": request["request_id"], "result": {"Ok": result}},
                )
    finally:
        discovery_path.unlink(missing_ok=True)
        sock.close()
        endpoint.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
