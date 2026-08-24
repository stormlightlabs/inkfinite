# `org.stormlightlabs.inkfinite.snapshot`

## Purpose

A published Inkfinite version that clients treat as immutable.

`document` points to the stable logical document URI. `content` captures the
native bytes for this publication. Snapshot records use TID keys, so a document
can have many independently addressable published states.

Snapshots support permanent links, publication history, reproducible citations,
version-specific forks, and version-specific annotations without changing the
mutable `document` record.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.snapshot",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "A published Inkfinite version that clients treat as immutable.",
      "record": {
        "type": "object",
        "required": ["document", "formatVersion", "content", "createdAt"],
        "properties": {
          "document": {
            "type": "string",
            "format": "at-uri",
            "description": "Stable AT URI of the logical Inkfinite document."
          },
          "formatVersion": {
            "type": "integer",
            "minimum": 1
          },
          "content": {
            "type": "blob",
            "accept": ["application/vnd.inkfinite.document"]
          },
          "title": {
            "type": "string",
            "maxLength": 2048,
            "maxGraphemes": 160,
            "description": "Optional title captured for this published version."
          },
          "preview": {
            "type": "blob",
            "accept": ["image/png", "image/jpeg", "image/webp"]
          },
          "createdAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    }
  }
}
```

## Notes

- The `document` field is an AT URI, not a strong ref: it names the stable
  logical document, not whichever mutable record CID happened to exist when the
  snapshot was created.
- Clients should not update snapshot records after creation.
- An AppView can index `snapshot.document` to list publication history.
