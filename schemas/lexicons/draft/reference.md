# `org.stormlightlabs.inkfinite.reference`

## Purpose

An explicit semantic relationship between two logical published documents.

The record does not project every arrow or binding drawn on the canvas. Create
it only when a user promotes a relationship to network-level metadata that
clients should discover independently of the document blob.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.reference",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "An explicit semantic relationship between published Inkfinite documents.",
      "record": {
        "type": "object",
        "required": ["source", "target", "relation", "createdAt"],
        "properties": {
          "source": {
            "type": "string",
            "format": "at-uri"
          },
          "target": {
            "type": "string",
            "format": "at-uri"
          },
          "relation": {
            "type": "string",
            "maxLength": 256,
            "knownValues": [
              "related",
              "references",
              "derivedFrom",
              "continues"
            ],
            "description": "Application-defined semantic relationship. Known values are suggestions, not a closed enum."
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

- Keep the relation vocabulary deliberately small until actual workflows reveal
  useful semantics.
- Because `knownValues` is extensible, clients can preserve unfamiliar relation
  values.
- An AppView can later materialize backlinks and a global document graph from
  these records.
