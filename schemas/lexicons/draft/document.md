# `org.stormlightlabs.inkfinite.document`

## Purpose

The stable public identity of one logical Inkfinite document.

Keep the record mutable. Publishing new work updates the manifest and blob
reference while preserving the document's AT URI. The native `.inkfinite` blob
remains the source of truth for editable content and Automerge history.

The record key should use the stable Inkfinite `DocumentId` with Lexicon key
kind `any`. At the application boundary, Inkfinite should validate that the rkey
is a valid document identifier and matches the native document loaded from the
blob.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.document",
  "defs": {
    "main": {
      "type": "record",
      "key": "any",
      "description": "A stable published Inkfinite document whose editable native representation is stored as a blob.",
      "record": {
        "type": "object",
        "required": ["formatVersion", "content"],
        "properties": {
          "formatVersion": {
            "type": "integer",
            "minimum": 1,
            "description": "Inkfinite document format version used by the content."
          },
          "content": {
            "type": "blob",
            "accept": ["application/vnd.inkfinite.document"],
            "description": "Canonical editable .inkfinite document bytes."
          },
          "title": {
            "type": "string",
            "maxLength": 2048,
            "maxGraphemes": 160
          },
          "description": {
            "type": "string",
            "maxLength": 8192,
            "maxGraphemes": 1024
          },
          "preview": {
            "type": "blob",
            "accept": ["image/png", "image/jpeg", "image/webp"],
            "description": "Optional preview image generated from the document."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime"
          },
          "updatedAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    }
  }
}
```

## Semantics

A URI such as:

```text
at://did:plc:example/org.stormlightlabs.inkfinite.document/<document-id>
```

means "this actor's logical Inkfinite document" rather than a particular
publication version.

When available, use repository compare-and-swap when updating the record so
two clients do not silently overwrite each other's publication metadata.

## Excluded fields

Do not add derived/indexed properties such as:

- star or fork counts;
- full-text search projections;
- backlinks;
- page or shape counts;
- hydrated author information.

Do not expose pages, shapes, layers, bindings, assets, or Automerge changes as
nested protocol data for indexing. Those remain concerns of the Inkfinite
format.
