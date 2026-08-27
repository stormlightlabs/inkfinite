//! Shared deterministic fixtures used by native and process performance measurements.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::engine::TransactionEngine;
use crate::proto::{Operation, ShapePatch, TransactionDraft, TransactionId};
use crate::{
    ActorId, BindingAnchor, BindingId, BindingKind, BindingRecord, ContainerLayout, Document, DocumentId, LayerId,
    LayerRecord, Opacity, Origin, PageId, PageRecord, PathFillRule, Provenance, RecordVersion, SemanticMetadata,
    ShapeId, ShapeKind, ShapeParent, ShapeRecord, ShapeStyle, Timestamp, Transform, Vec2,
};

const CORPUS: &str = include_str!("../fixtures/performance-corpus.json");
/// Actor used to create deterministic benchmark fixtures.
pub const ACTOR: &str = "actor:criterion";

/// The deterministic performance corpus manifest.
#[derive(Clone, Debug, Deserialize)]
pub struct CorpusManifest {
    /// Manifest schema version.
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    /// Seed used for generated content.
    pub seed: u64,
    /// Shape counts represented by every profile.
    pub sizes: Vec<usize>,
    /// Document structures represented by the corpus.
    pub profiles: Vec<Profile>,
}

/// One document structure in the shared performance corpus.
#[derive(Clone, Debug, Deserialize)]
pub struct Profile {
    /// Stable profile identifier.
    pub id: String,
    /// Shape kind used by the profile.
    pub kind: String,
    /// Number of path segments for vector-heavy profiles.
    #[serde(default)]
    pub segments: Option<usize>,
    /// Maximum container depth for nested profiles.
    #[serde(default)]
    #[serde(rename = "nestingDepth")]
    pub nesting_depth: Option<usize>,
    /// Whether generated shapes carry semantic metadata.
    #[serde(default)]
    pub metadata: bool,
    /// Relationship or endpoint binding structure.
    #[serde(default)]
    pub bindings: Option<String>,
}

/// Materialized native state for one corpus profile and shape count.
#[derive(Clone)]
pub struct PerformanceFixture {
    /// Generated normalized document.
    pub document: Document,
    /// Compact canonical Automerge bytes.
    pub bytes: Vec<u8>,
    /// Materialized snapshot used by rendering and inspection benchmarks.
    pub snapshot: crate::DocumentSnapshot,
    /// Fresh transaction engine used by operation benchmarks.
    pub engine: TransactionEngine,
}

/// Returns the checked-in deterministic corpus manifest.
#[must_use]
pub fn manifest() -> CorpusManifest {
    let manifest: CorpusManifest = serde_json::from_str(CORPUS).expect("performance corpus must be valid JSON");
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.seed, 439_041_101);
    manifest
}

/// Returns every profile and shape-count pair in stable manifest order.
#[must_use]
pub fn cases() -> (u64, Vec<(Profile, usize)>) {
    let manifest = manifest();
    let cases = manifest
        .profiles
        .into_iter()
        .flat_map(|profile| manifest.sizes.iter().copied().map(move |size| (profile.clone(), size)))
        .collect();
    (manifest.seed, cases)
}

/// Builds one deterministic native fixture from a corpus profile.
pub fn fixture(profile: &Profile, size: usize, seed: u64) -> PerformanceFixture {
    let document = create_document(profile, size, seed);
    let document_id = DocumentId::from(format!("document:performance:{}:{size}", profile.id));
    let actor = ActorId::from(ACTOR);
    let mut engine = TransactionEngine::create(document_id, actor, document.clone())
        .expect("performance fixture must satisfy document invariants");
    let bytes = engine.save().expect("performance fixture must save");
    let snapshot = engine.snapshot().expect("performance fixture must materialize");
    PerformanceFixture { document, bytes, snapshot, engine }
}

fn create_document(profile: &Profile, size: usize, seed: u64) -> Document {
    let page_id = PageId::from(format!("page:performance:{}:{size}", profile.id));
    let layer_id = LayerId::from(format!("layer:performance:{}:{size}", profile.id));
    let shape_id = |index: usize| ShapeId::from(format!("shape:performance:{}:{size}:{index:05}", profile.id));
    let mut shapes = BTreeMap::new();
    let mut bindings = BTreeMap::new();
    let mut layer_shape_ids = Vec::with_capacity(size);
    let depth_limit = profile.nesting_depth.unwrap_or(0).min(size);

    for index in 0..size {
        let id = shape_id(index);
        let parent = if profile.id == "deeply-nested" && index > 0 {
            let parent_index = if index < depth_limit { index - 1 } else { depth_limit - 1 };
            ShapeParent::Shape(shape_id(parent_index))
        } else {
            ShapeParent::Layer(layer_id.clone())
        };
        let column = index % 100;
        let row = index / 100;
        let metadata = metadata(profile, index, seed);
        let (kind, properties) = shape_kind_and_properties(profile, index, size, seed);
        let container = kind.as_str() == "container";
        shapes.insert(
            id.clone(),
            ShapeRecord {
                id: id.clone(),
                kind,
                parent,
                transform: Transform {
                    translation: Vec2 { x: (column * 80) as f64, y: (row * 80) as f64 },
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                },
                child_ids: Vec::new(),
                layout: container.then_some(ContainerLayout::Free),
                properties,
                metadata,
                style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
                version: RecordVersion(1),
            },
        );
        layer_shape_ids.push(id);
    }

    if profile.id == "deeply-nested" && depth_limit > 0 {
        for index in 1..size {
            let parent_index = if index < depth_limit { index - 1 } else { depth_limit - 1 };
            shapes
                .get_mut(&shape_id(parent_index))
                .expect("nested parent exists")
                .child_ids
                .push(shape_id(index));
        }
        layer_shape_ids.truncate(1);
    }

    add_bindings(profile, size, &shape_id, &mut bindings);
    let page = PageRecord {
        id: page_id.clone(),
        name: format!("Performance {}", profile.id),
        layer_ids: vec![layer_id.clone()],
        version: RecordVersion(1),
    };
    let layer = LayerRecord {
        id: layer_id,
        page_id: page_id.clone(),
        name: "Default".into(),
        shape_ids: layer_shape_ids,
        visible: true,
        locked: false,
        opacity: Opacity::OPAQUE,
        version: RecordVersion(1),
    };
    Document {
        pages: BTreeMap::from([(page_id.clone(), page)]),
        page_ids: vec![page_id],
        layers: BTreeMap::from([(layer.id.clone(), layer)]),
        shapes,
        bindings,
        assets: BTreeMap::new(),
    }
}

fn shape_kind_and_properties(
    profile: &Profile, index: usize, size: usize, seed: u64,
) -> (ShapeKind, BTreeMap<String, Value>) {
    let column = index % 100;
    let row = index / 100;
    let fill = if index.is_multiple_of(2) { "#dbeafe" } else { "#fef3c7" };
    if profile.kind == "arrow" && index % 2 == 1 {
        return (
            ShapeKind::from("arrow"),
            BTreeMap::from([
                (
                    "points".into(),
                    json!([{ "x": 0.0, "y": 0.0 }, { "x": 80.0, "y": 0.0 }]),
                ),
                (
                    "style".into(),
                    json!({ "stroke": "#475569", "width": 2.0, "head_end": true }),
                ),
            ]),
        );
    }
    if profile.kind == "path" {
        return (
            ShapeKind::from("path"),
            path_properties(profile.segments.unwrap_or(8), fill),
        );
    }
    if profile.id == "deeply-nested" && index < profile.nesting_depth.unwrap_or(0) {
        return (
            ShapeKind::from("container"),
            BTreeMap::from([
                ("width".into(), json!(72.0 + (index * 2) as f64)),
                ("height".into(), json!(56.0 + (index * 2) as f64)),
                ("title".into(), json!(format!("Group {index}"))),
                ("fill".into(), json!("#f8fafc")),
                ("stroke".into(), json!("#94a3b8")),
                ("radius".into(), json!(8.0)),
            ]),
        );
    }
    (
        ShapeKind::from("rect"),
        BTreeMap::from([
            ("width".into(), json!(48.0 + ((index as u64 * 17 + seed) % 17) as f64)),
            ("height".into(), json!(40.0 + ((index as u64 * 29 + seed) % 25) as f64)),
            ("fill".into(), json!(fill)),
            ("stroke".into(), json!("#334155")),
            ("radius".into(), json!((index % 5) as f64)),
            ("column".into(), json!(column)),
            ("row".into(), json!(row)),
            ("fixture_size".into(), json!(size)),
        ]),
    )
}

fn path_properties(segment_count: usize, fill: &str) -> BTreeMap<String, Value> {
    let mut segments = vec![json!({ "type": "move", "to": { "x": 0.0, "y": 0.0 } })];
    let mut current = (0.0, 0.0);
    for index in 1..segment_count {
        let next = (24.0 + index as f64 * 7.0, 18.0 + (index * 13 % 42) as f64);
        let segment = match index % 3 {
            0 => json!({
                "type": "cubic",
                "control_1": { "x": current.0 + 8.0, "y": current.1 - 12.0 },
                "control_2": { "x": next.0 - 8.0, "y": next.1 + 12.0 },
                "to": { "x": next.0, "y": next.1 }
            }),
            1 => json!({ "type": "line", "to": { "x": next.0, "y": next.1 } }),
            _ => json!({
                "type": "quadratic",
                "control": { "x": (current.0 + next.0) / 2.0, "y": next.1 - 18.0 },
                "to": { "x": next.0, "y": next.1 }
            }),
        };
        segments.push(segment);
        current = next;
    }
    BTreeMap::from([
        ("subpaths".into(), json!([{ "segments": segments, "closed": true }])),
        ("fill_rule".into(), json!(PathFillRule::NonZero)),
        ("fill".into(), json!(fill)),
        ("stroke".into(), json!("#334155")),
        ("stroke_width".into(), json!(2.0)),
    ])
}

fn metadata(profile: &Profile, index: usize, seed: u64) -> SemanticMetadata {
    let semantic = profile.metadata;
    SemanticMetadata {
        name: semantic.then(|| format!("Service {index}")),
        title: semantic.then(|| format!("Corpus item {index}")),
        role: semantic
            .then(|| if index.is_multiple_of(2) { "architecture.service" } else { "architecture.worker" }.into()),
        description: semantic.then(|| format!("Deterministic performance fixture item {index}")),
        body: semantic.then(|| "Generated semantic content for query and projection measurements.".into()),
        tags: if semantic {
            vec![
                "performance".into(),
                if index.is_multiple_of(2) { "service" } else { "worker" }.into(),
                format!("bucket-{}", index % 8),
            ]
        } else {
            Vec::new()
        },
        source: semantic.then(|| "fixtures/native/performance/corpus.json".into()),
        link: semantic.then(|| format!("https://example.test/performance/{index}")),
        custom_metadata: if semantic {
            BTreeMap::from([
                ("seed".into(), json!(seed)),
                ("index".into(), json!(index)),
                ("profile".into(), json!(&profile.id)),
            ])
        } else {
            BTreeMap::new()
        },
        locked: false,
        agent_editable: true,
        provenance: Provenance {
            actor_id: ActorId::from(ACTOR),
            origin: Origin::System,
            timestamp: Timestamp(index as i64),
            source: semantic.then(|| "performance-corpus".into()),
        },
    }
}

fn add_bindings(
    profile: &Profile, size: usize, shape_id: &impl Fn(usize) -> ShapeId,
    bindings: &mut BTreeMap<BindingId, BindingRecord>,
) {
    match profile.bindings.as_deref() {
        Some("arrow-end") => {
            for index in (1..size).step_by(2) {
                let source = shape_id(index);
                let start_target = shape_id(index - 1);
                let end_target = shape_id(if index + 1 < size { index + 1 } else { 0 });
                for (handle, target) in [("start", start_target), ("end", end_target)] {
                    let id = BindingId::from(format!("binding:performance:{}:{size}:{index}:{handle}", profile.id));
                    bindings.insert(
                        id.clone(),
                        BindingRecord {
                            id,
                            kind: BindingKind::from("arrow-end"),
                            source_shape_id: source.clone(),
                            target_shape_id: target,
                            source_handle: handle.into(),
                            anchor: BindingAnchor::Center,
                            relation_type: None,
                            version: RecordVersion(1),
                        },
                    );
                }
            }
        }
        Some("relation") => {
            for index in 1..size {
                let id = BindingId::from(format!("binding:performance:{}:{size}:{index}", profile.id));
                bindings.insert(
                    id.clone(),
                    BindingRecord {
                        id,
                        kind: BindingKind::from("relation"),
                        source_shape_id: shape_id(index - 1),
                        target_shape_id: shape_id(index),
                        source_handle: "end".into(),
                        anchor: BindingAnchor::Center,
                        relation_type: Some(if index.is_multiple_of(2) { "depends_on" } else { "contains" }.into()),
                        version: RecordVersion(1),
                    },
                );
            }
        }
        _ => {}
    }
}

/// Creates a one-shape transform patch against a fixture snapshot.
pub fn patch_transaction(snapshot: &crate::DocumentSnapshot, shape_id: ShapeId, offset: i32) -> TransactionDraft {
    let shape = snapshot.document.shapes.get(&shape_id).expect("shape exists");
    let mut transform = shape.transform;
    transform.translation.x += f64::from(offset);
    TransactionDraft {
        id: TransactionId(format!("transaction:criterion:{offset}")),
        actor_id: ActorId::from(ACTOR),
        origin: Origin::System,
        base_heads: snapshot.heads.clone(),
        description: "criterion shape patch".into(),
        operations: vec![Operation::PatchShape {
            shape_id,
            patch: ShapePatch { transform: Some(transform), ..ShapePatch::default() },
            expected_version: None,
        }],
        timestamp: Timestamp(i64::from(offset)),
    }
}

#[cfg(test)]
mod tests {
    use super::CORPUS;

    #[test]
    fn packaged_manifest_matches_shared_performance_corpus() {
        assert_eq!(CORPUS, include_str!("../../../fixtures/native/performance/corpus.json"));
    }
}
