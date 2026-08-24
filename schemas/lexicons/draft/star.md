# `org.stormlightlabs.inkfinite.star`

## Purpose

A public expression of interest in a logical Inkfinite document.

A star follows the document identity, not a particular version, so `subject`
is a normal AT URI rather than a strong ref.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.star",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "A public star on a logical Inkfinite document.",
      "record": {
        "type": "object",
        "required": ["subject", "createdAt"],
        "properties": {
          "subject": {
            "type": "string",
            "format": "at-uri",
            "description": "Stable URI of the starred Inkfinite document."
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

A cross-repository index is needed for efficient `listStars(document)` or
`starCount(document)` queries. The star record itself should not carry counts
or hydrated document metadata.
