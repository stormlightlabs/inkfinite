use std::collections::BTreeMap;

use crate::{ActorId, Document, DocumentId, ShapeId, ShapeProperties};
use serde_json::json;

use super::{AutomergeDocument, AutomergeSyncSession, CrdtDocument, SyncSession};

fn empty_document() -> Document {
    Document {
        pages: BTreeMap::new(),
        page_ids: Vec::new(),
        layers: BTreeMap::new(),
        shapes: BTreeMap::new(),
        bindings: BTreeMap::new(),
        assets: BTreeMap::new(),
    }
}

#[test]
fn nested_properties_heads_actor_save_load_and_compaction_round_trip() {
    let mut document = empty_document();
    let mut properties = ShapeProperties::new();
    properties.insert("nested".into(), json!({"items": [1, 2], "text": "hello"}));
    let mut nested_shape = crate_test_shape(0);
    nested_shape.properties = properties.clone();
    document
        .shapes
        .insert(nested_shape.id.clone(), nested_shape);
    let mut crdt = AutomergeDocument::create(
        DocumentId::from("document:test"),
        ActorId::from("actor:a"),
        document.clone(),
    )
    .unwrap();
    let heads = crdt.heads();
    assert_eq!(crdt.actor_id(), ActorId::from("actor:a"));
    let saved = crdt.save().unwrap();
    let mut loaded = AutomergeDocument::load(&saved, ActorId::from("actor:b")).unwrap();
    assert_eq!(loaded.snapshot().unwrap().document, document);
    assert_eq!(loaded.heads(), heads);
    assert!(loaded.compact().unwrap().len() <= saved.len());
    assert!(properties.contains_key("nested"));
}

#[test]
fn changes_and_transport_independent_sync_converge() {
    let mut left = AutomergeDocument::create(
        DocumentId::from("document:test"),
        ActorId::from("actor:left"),
        empty_document(),
    )
    .unwrap();
    let bytes = left.save().unwrap();
    let mut right = AutomergeDocument::load(&bytes, ActorId::from("actor:right")).unwrap();
    let base = left.heads();
    let mut changed = empty_document();
    changed.page_ids.push(crate::PageId::from("page:one"));
    left.commit_document(&changed, "add page id").unwrap();
    assert_eq!(left.changes_since(&base).unwrap().len(), 1);

    let mut left_sync = AutomergeSyncSession::new();
    let mut right_sync = AutomergeSyncSession::new();
    for _ in 0..20 {
        let left_message = left_sync.generate_message(&mut left).unwrap();
        let right_message = right_sync.generate_message(&mut right).unwrap();
        let done = left_message.is_none() && right_message.is_none();
        if let Some(message) = left_message {
            right_sync.receive_message(&mut right, &message).unwrap();
        }
        if let Some(message) = right_message {
            left_sync.receive_message(&mut left, &message).unwrap();
        }
        if done {
            break;
        }
    }
    assert_eq!(left.snapshot().unwrap(), right.snapshot().unwrap());
    assert!(
        !left
            .snapshot()
            .unwrap()
            .document
            .shapes
            .contains_key(&ShapeId::from("missing"))
    );
}

#[test]
#[ignore = "large production benchmark; run explicitly for V2 performance verification"]
fn ten_thousand_shape_projection_round_trips() {
    let mut document = empty_document();
    for index in 0_u32..10_000 {
        document.shapes.insert(
            ShapeId::new(format!("shape:{index:05}")),
            crate_test_shape(index),
        );
    }
    let mut crdt = AutomergeDocument::create(
        DocumentId::from("document:large"),
        ActorId::from("actor:large"),
        document.clone(),
    )
    .unwrap();
    let bytes = crdt.save().unwrap();
    let mut loaded = AutomergeDocument::load(&bytes, ActorId::from("actor:load")).unwrap();
    assert_eq!(loaded.snapshot().unwrap().document, document);
}

fn crate_test_shape(index: u32) -> crate::ShapeRecord {
    use crate::{
        LayerId, Opacity, Origin, Provenance, RecordVersion, SemanticMetadata, ShapeKind,
        ShapeParent, ShapeStyle, Timestamp, Transform, Vec2,
    };
    crate::ShapeRecord {
        id: ShapeId::new(format!("shape:{index:05}")),
        kind: ShapeKind::from("rect"),
        parent: ShapeParent::Layer(LayerId::from("layer:one")),
        transform: Transform {
            translation: Vec2 {
                x: f64::from(index),
                y: 0.0,
            },
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        },
        child_ids: Vec::new(),
        layout: None,
        properties: BTreeMap::from([
            ("width".into(), json!(10.0)),
            ("height".into(), json!(10.0)),
        ]),
        metadata: SemanticMetadata {
            name: None,
            role: None,
            description: None,
            tags: Vec::new(),
            locked: false,
            agent_editable: true,
            provenance: Provenance {
                actor_id: ActorId::from("actor:large"),
                origin: Origin::System,
                timestamp: Timestamp(0),
                source: None,
            },
        },
        style: ShapeStyle {
            opacity: Opacity::OPAQUE,
            fill_opacity: None,
            stroke_opacity: None,
        },
        version: RecordVersion(1),
    }
}
