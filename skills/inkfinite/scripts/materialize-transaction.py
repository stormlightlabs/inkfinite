#!/usr/bin/env python3
"""
==============================================================================
DESCRIPTION: Copies current heads from CLI inspect output into a transaction
             template for dry-run, apply, proposal, or conflict fixtures.
AUTHOR:      Owais <info@stormlightlabs.org>
VERSION:     0.0.0
USAGE:       python3 materialize-transaction.py --heads INSPECT_JSON
             --template TEMPLATE_JSON --output TRANSACTION_JSON
==============================================================================
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--heads",
        type=Path,
        required=True,
        help="JSON output from inspect or app inspect",
    )
    parser.add_argument(
        "--template", type=Path, required=True, help="TransactionDraft JSON template"
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Materialized transaction path"
    )
    args = parser.parse_args()

    heads_document = json.loads(args.heads.read_text(encoding="utf-8"))
    heads = heads_document.get("heads")
    if (
        not isinstance(heads, list)
        or not heads
        or not all(isinstance(head, str) and head for head in heads)
    ):
        raise SystemExit("inspect output must contain a non-empty string heads array")

    transaction = json.loads(args.template.read_text(encoding="utf-8"))
    if not isinstance(transaction, dict):
        raise SystemExit("transaction template must be a JSON object")
    transaction["base_heads"] = heads
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(transaction, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
