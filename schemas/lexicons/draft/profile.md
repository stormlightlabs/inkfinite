# `org.stormlightlabs.inkfinite.profile` (deferred)

## Status

Do not implement this initially.

The AT Protocol provides DID and handle identity. Other application ecosystems
may provide profile metadata. The Inkfinite declaration record signals
participation without introducing another source of truth for a person's
name, avatar, or bio.

If Inkfinite later needs application-specific presentation metadata, use a
singleton profile like this.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.profile",
  "defs": {
    "main": {
      "type": "record",
      "key": "literal:self",
      "description": "Optional Inkfinite-specific profile metadata for an AT Protocol account.",
      "record": {
        "type": "object",
        "properties": {
          "displayName": {
            "type": "string",
            "maxLength": 640,
            "maxGraphemes": 64
          },
          "description": {
            "type": "string",
            "maxLength": 4096,
            "maxGraphemes": 512
          },
          "featuredDocument": {
            "type": "string",
            "format": "at-uri"
          }
        }
      }
    }
  }
}
```

## Revisit only if

- Inkfinite needs profile fields that are distinct from generic AT Protocol
  identity or profile data;
- those fields are useful to third-party clients that interoperate with
  Inkfinite;
- a duplicate profile has a clear owner and update process.
