# AT Protocol lexicons for Inkfinite

These files sketch a possible Inkfinite integration with the AT Protocol, namely
proposed semantics and Lexicon shapes.

## Goals

The AT Protocol layer should provide portable publication, identity, provenance,
and relationships across repositories without becoming Inkfinite's document model.

Inkfinite's native `.inkfinite` document is canonical. AT Protocol records
carry compact manifests and relationships. Native documents are stored as blobs
and interpreted by Inkfinite.

## Namespace

The sketches use:

```text
org.stormlightlabs.inkfinite.*
```

## Design rules

1. We want to keep the document model opaque to the AT Protocol.
   No pages, layers, shapes, bindings, or Automerge changes as separate repository records.
2. strong refs only for version-specific claims. Forking or annotating a
   particular snapshot should bind to a URI and CID. A star on a logical
   document generally should use only the URI.
3. Prefer optional fields. Required fields should be limited to data needed to
   preserve the record's core semantics.
4. Aggregates should be kept out of records. Counts, search text, backlinks, recent
   activity, and hydrated views belong in an AppView or index.
5. Assume that publication is public. This design does not define private
   records or private blob storage (even though that's alpha now!)

## Rollout

### Initial publication

1. [Declarations](./declaration.md)
2. [Documents](./document.md)

Together, these records support authentication, native document publication,
access through a known AT URI, and listing Inkfinite documents for a known DID
without an AppView.

### Publication history

[Snapshots](./snapshot.md) give each published version an immutable identity without
changing the stable logical document URI.

### Network relationships

- [Forks](./fork.md)
- [Stars](./star.md)
- [Collections](./collection.md)
- [References](./reference.md)

These are useful when an AppView can look up relationships across repos.

### Review and discussion

- [Comment](./comment.md)
- [Annotations](./annotation.md)

Annotations target stable Inkfinite object identifiers inside an immutable
snapshot rather than exposing all internal document objects as AT Protocol
records.

### Profiles and indexing

- [Profile](./profile.md)
- [AppView](./appview.md)

## Open questions

- Final MIME type for `.inkfinite` native blobs.
- Maximum native blob size acceptable for publication.
- Whether publishing a document should always create a snapshot or leave that
  as an explicit "permanent version" action.
- Whether tags belong on the document manifest, in a sidecar record, or only in
  an AppView projection.
- Whether comments should be editable or append-only by convention.
- Whether collections should remain small inline lists or eventually use
  separate membership records.
