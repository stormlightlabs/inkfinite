# Inkfinite AppView lexicons (future)

## Status

Do not build an AppView for the first publication integration.

Clients can read known records and list records for a known actor through PDS
repository APIs. Add an AppView when Inkfinite needs queries across
repositories, such as search, recent documents, stars, forks, backlinks,
comments, or annotations.

The AppView should index manifests and relationships. It should not become the
canonical store for `.inkfinite` content.

## Candidate indexed state

```text
actors
  did
  declaration_present

records
  uri
  cid
  collection
  repo_did
  indexed_at

documents
  uri
  cid
  title
  description
  format_version
  blob_cid
  preview_cid
  created_at
  updated_at

snapshots
forks
stars
comments
annotations
collections
references
```

Counts, hydrated author data, preview URLs, search matches, and viewer-specific
state are AppView projections rather than repo record fields.

## Candidate query Lexicons

Start with a very small query surface.

### `org.stormlightlabs.inkfinite.getDocument`

```json
{
  "lexicon": 1,
  "id": "org.stormlightlabs.inkfinite.getDocument",
  "defs": {
    "main": {
      "type": "query",
      "description": "Returns a hydrated view of one indexed Inkfinite document.",
      "parameters": {
        "type": "params",
        "required": ["uri"],
        "properties": {
          "uri": {
            "type": "string",
            "format": "at-uri"
          }
        }
      },
      "output": {
        "encoding": "application/json",
        "schema": {
          "type": "ref",
          "ref": "org.stormlightlabs.inkfinite.getDocument#documentView"
        }
      }
    },
    "documentView": {
      "type": "object",
      "required": ["uri", "cid", "record"],
      "properties": {
        "uri": {
          "type": "string",
          "format": "at-uri"
        },
        "cid": {
          "type": "string",
          "format": "cid"
        },
        "record": {
          "type": "unknown",
          "description": "Original document record, returned without changes."
        },
        "starCount": {
          "type": "integer",
          "minimum": 0
        },
        "forkCount": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  }
}
```

The `unknown` record field is a placeholder. Before publishing this Lexicon,
replace it with a reference to the document record or a reusable `defs` view
schema. Keep the original record unchanged in hydrated responses.

### Candidate endpoints

```text
org.stormlightlabs.inkfinite.getDocument
org.stormlightlabs.inkfinite.listDocuments
org.stormlightlabs.inkfinite.searchDocuments
org.stormlightlabs.inkfinite.listSnapshots
org.stormlightlabs.inkfinite.listForks
org.stormlightlabs.inkfinite.listStars
org.stormlightlabs.inkfinite.listComments
org.stormlightlabs.inkfinite.listAnnotations
org.stormlightlabs.inkfinite.getCollection
org.stormlightlabs.inkfinite.listCollections
org.stormlightlabs.inkfinite.listReferences
```

Do not publish the entire endpoint set at once. Add each endpoint with the
indexing feature that requires it.

## Full-text search

A future AppView could download native blobs and extract a searchable
projection, such as text shapes, Markdown, card titles, URLs, and semantic
metadata. Keep that projection in the index. Do not write it back as another
canonical representation of the document.
