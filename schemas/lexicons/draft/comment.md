# `org.stormlightlabs.inkfinite.comment`

## Purpose

A document-level comment that does not modify the editable canvas model.

Comments are network objects, not Inkfinite shapes. Clients can render them in
an inspector, side panel, review view, or external AppView without mutating the
underlying `.inkfinite` document.

## Lexicon sketch

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.comment",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "A comment on an Inkfinite document or snapshot.",
      "record": {
        "type": "object",
        "required": ["subject", "text", "createdAt"],
        "properties": {
          "subject": {
            "type": "string",
            "format": "at-uri",
            "description": "Inkfinite document or snapshot being discussed."
          },
          "text": {
            "type": "string",
            "maxLength": 8192,
            "maxGraphemes": 1024
          },
          "replyTo": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Optional exact parent comment for a threaded reply."
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

## Open question: editing

If clients can edit comments, `replyTo` as a strong ref binds a reply to the
parent version that existed when the reply was created. This preserves an audit
property but may be stricter than needed. Decide the edit semantics before
publishing this Lexicon.
