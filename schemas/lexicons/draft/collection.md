# `org.stormlightlabs.inkfinite.collection`

## Purpose

A named, ordered public set of logical Inkfinite documents, such as research
boards, system-design resources, sketches, project canvases, or other curated
groups.

Keep the first design's list of up to 100 items inline. If collections exceed
that limit or need concurrent editing, move membership into a separate record
type rather than growing this record into an array with no size limit.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.collection",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "A named, ordered collection of Inkfinite documents.",
      "record": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 1024,
            "maxGraphemes": 100
          },
          "description": {
            "type": "string",
            "maxLength": 8192,
            "maxGraphemes": 1024
          },
          "items": {
            "type": "array",
            "maxLength": 100,
            "items": {
              "type": "ref",
              "ref": "org.stormlightlabs.inkfinite.collection#item"
            }
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
    },
    "item": {
      "type": "object",
      "required": ["document"],
      "properties": {
        "document": {
          "type": "string",
          "format": "at-uri"
        },
        "note": {
          "type": "string",
          "maxLength": 2048,
          "maxGraphemes": 256
        }
      }
    }
  }
}
```

## Possible later split

If the inline list no longer meets a collection's size or editing needs, add a
record such as:

```text
org.stormlightlabs.inkfinite.collectionItem
```

with a stable collection URI, document URI, ordering key, and creation time.
Publish this extra record type only when a concrete need for it exists.
