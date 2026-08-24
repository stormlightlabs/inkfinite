# `org.stormlightlabs.inkfinite.fork`

## Purpose

Records provenance when one Inkfinite document is created from a specific
published snapshot of another document.

The source is version-specific and therefore uses `com.atproto.repo.strongRef`.
The destination is a stable logical document URI.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.fork",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "Declares that an Inkfinite document was forked from a specific published snapshot.",
      "record": {
        "type": "object",
        "required": ["source", "document", "createdAt"],
        "properties": {
          "source": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Exact source snapshot URI and CID."
          },
          "document": {
            "type": "string",
            "format": "at-uri",
            "description": "Stable URI of the resulting logical Inkfinite document."
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

## Application validation

An Inkfinite AppView should verify the following:

- `source.uri` identifies an Inkfinite snapshot;
- `document` identifies an Inkfinite document;
- normally, the destination document belongs to the actor publishing the fork
  record.

This record describes provenance only. It does not define merge behavior or a
Git-like branch model.
