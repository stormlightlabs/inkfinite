# `org.stormlightlabs.inkfinite.declaration`

## Purpose

A singleton record that indicates an AT Protocol account participates in
Inkfinite.

The record has no fields; its presence signals participation. A future indexer
can list accounts that have the record, while deleting it can signal that an
account has left or disabled Inkfinite participation.

Use record key `self`.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.declaration",
  "defs": {
    "main": {
      "type": "record",
      "key": "literal:self",
      "description": "Declares that this AT Protocol account participates in Inkfinite.",
      "record": {
        "type": "object",
        "properties": {}
      }
    }
  }
}
```

## Notes

- Do not treat this as an Inkfinite user profile.
- The DID and handle already provide network identity.
- AppViews may use the presence or deletion of this record as a participation
  signal.
- Keep additional profile-like information in a separate record type if needed.
