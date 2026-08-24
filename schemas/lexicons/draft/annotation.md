# `org.stormlightlabs.inkfinite.annotation`

## Purpose

A review or discussion attached to a stable semantic object in a published
Inkfinite snapshot.

The annotation uses a strong reference to the snapshot, so clients interpret it
against the exact document bytes. Its target uses Inkfinite's stable object IDs;
those objects do not become independent AT Protocol records.

The initial schema targets document, page, shape, and binding identities. It omits
region and coordinate targets because the AT Protocol data model has no
floating-point type and Inkfinite geometry uses floating-point values.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.annotation",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "An annotation attached to a target in an Inkfinite snapshot.",
      "record": {
        "type": "object",
        "required": ["subject", "target", "text", "createdAt"],
        "properties": {
          "subject": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Exact Inkfinite snapshot that contains the target."
          },
          "target": {
            "type": "union",
            "refs": [
              "org.stormlightlabs.inkfinite.annotation#documentTarget",
              "org.stormlightlabs.inkfinite.annotation#pageTarget",
              "org.stormlightlabs.inkfinite.annotation#shapeTarget",
              "org.stormlightlabs.inkfinite.annotation#bindingTarget"
            ]
          },
          "text": {
            "type": "string",
            "maxLength": 8192,
            "maxGraphemes": 1024
          },
          "createdAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    },
    "documentTarget": {
      "type": "object",
      "description": "The snapshot as a whole.",
      "properties": {}
    },
    "pageTarget": {
      "type": "object",
      "required": ["pageId"],
      "properties": {
        "pageId": {
          "type": "string",
          "maxLength": 256
        }
      }
    },
    "shapeTarget": {
      "type": "object",
      "required": ["shapeId"],
      "properties": {
        "shapeId": {
          "type": "string",
          "maxLength": 256
        }
      }
    },
    "bindingTarget": {
      "type": "object",
      "required": ["bindingId"],
      "properties": {
        "bindingId": {
          "type": "string",
          "maxLength": 256
        }
      }
    }
  }
}
```

## Example record value

```json
{
  "$type": "org.stormlightlabs.inkfinite.annotation",
  "subject": {
    "uri": "at://did:plc:alice/org.stormlightlabs.inkfinite.snapshot/3abc",
    "cid": "bafy..."
  },
  "target": {
    "$type": "org.stormlightlabs.inkfinite.annotation#shapeTarget",
    "shapeId": "shape-a84"
  },
  "text": "This db adapter probably needs to be asynchronous.",
  "createdAt": "2026-08-24T06:20:00Z"
}
```

## Possible future targets

Later target variants could include text ranges, path positions, or rectangular
regions. Add them only after defining a deterministic wire representation that
does not use floating-point values and is independent of rendering precision.
