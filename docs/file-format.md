# Inkfinite file format

Inkfinite stores each document as an Automerge file with the `.inkfinite`
extension. The desktop app, CLI, and Rust session service all open, validate,
change, and save this same file type. There is no alternate user-facing
document extension.

## Document contract

The materialized snapshot carried by a file has a stable format identifier and
explicit contract version:

```rust
pub struct DocumentSnapshot {
    pub format: String,
    pub format_version: u32,
    pub document_id: DocumentId,
    pub heads: Vec<ChangeHash>,
    pub document: Document,
}
```

The document contains ordered pages, layers, shapes, bindings, and assets.
Pages own ordered layers; layers own ordered root shapes; containers own their
ordered child shapes. IDs and causal heads remain stable across saves and
replicas.

The CLI can print a deterministic JSON projection for inspection and CI. That
projection is not a second file format and cannot replace the Automerge history
or causal heads stored in the canonical file.

## Validation and safe writes

`DocumentFile` holds an advisory sidecar lock for the canonical path. Every
transaction is validated before it is committed. A save writes a temporary
same-directory replacement, flushes and syncs it, and then replaces the
canonical file. An interrupted replacement leaves bounded recovery data that
can be validated and saved as a new canonical baseline.

Invalid bytes, stale heads, missing references, and invalid record properties
are rejected before the canonical file is changed. Recovery uses the same
document validation and persistence path as a normal save.

## Versioning

`format_version` and protocol version fields are explicit so future releases
can reject unsupported data safely. They describe the current serialized
contract; they do not select between document models or file flows.
