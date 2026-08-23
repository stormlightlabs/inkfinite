use std::collections::BTreeMap;
use std::hint::black_box;
use std::time::Duration;

use criterion::{BatchSize, BenchmarkId, Criterion, criterion_group, criterion_main};
use inkfinite_core::engine::TransactionEngine;
use inkfinite_core::graph_layout::{
    GraphLayoutEdge, GraphLayoutGraph, GraphLayoutNode, GraphLayoutOptions, layout_graph,
};
use inkfinite_core::proto::{Bounds, Operation, Query, ShapePatch, TransactionDraft, TransactionId};
use inkfinite_core::render::{SvgRenderOptions, render_svg};
use inkfinite_core::svg_import::import_svg;
use inkfinite_core::{
    ActorId, BindingAnchor, BindingId, BindingKind, BindingRecord, ContainerLayout, Document, DocumentId, LayerId,
    LayerRecord, Opacity, Origin, PageId, PageRecord, PathFillRule, Provenance, RecordVersion, SemanticMetadata,
    ShapeId, ShapeKind, ShapeParent, ShapeRecord, ShapeStyle, Timestamp, Transform, Vec2,
};
use serde::Deserialize;
use serde_json::{Value, json};

const CORPUS: &str = include_str!("../../../fixtures/native/performance/corpus.json");
const SVG_FIXTURE: &str = include_str!("../../../fixtures/svg-import/icons/simple-github.svg");
const ACTOR: &str = "actor:criterion";

#[derive(Clone, Debug, Deserialize)]
struct CorpusManifest {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    seed: u64,
    sizes: Vec<usize>,
    profiles: Vec<Profile>,
}

#[derive(Clone, Debug, Deserialize)]
struct Profile {
    id: String,
    kind: String,
    #[serde(default)]
    segments: Option<usize>,
    #[serde(default)]
    #[serde(rename = "nestingDepth")]
    nesting_depth: Option<usize>,
    #[serde(default)]
    metadata: bool,
    #[serde(default)]
    bindings: Option<String>,
}

struct Fixture {
    document: Document,
    bytes: Vec<u8>,
    snapshot: inkfinite_core::DocumentSnapshot,
    engine: TransactionEngine,
}

fn manifest() -> CorpusManifest {
    let manifest: CorpusManifest = serde_json::from_str(CORPUS).expect("performance corpus must be valid JSON");
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.seed, 439_041_101);
    manifest
}

fn cases() -> (u64, Vec<(Profile, usize)>) {
    let manifest = manifest();
    let cases = manifest
        .profiles
        .into_iter()
        .flat_map(|profile| manifest.sizes.iter().copied().map(move |size| (profile.clone(), size)))
        .collect();
    (manifest.seed, cases)
}

fn fixture(profile: &Profile, size: usize, seed: u64) -> Fixture {
    let document = create_document(profile, size, seed);
    let document_id = DocumentId::from(format!("document:performance:{}:{size}", profile.id));
    let actor = ActorId::from(ACTOR);
    let mut engine = TransactionEngine::create(document_id, actor, document.clone())
        .expect("performance fixture must satisfy document invariants");
    let bytes = engine.save().expect("performance fixture must save");
    let snapshot = engine.snapshot().expect("performance fixture must materialize");
    Fixture { document, bytes, snapshot, engine }
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

fn criterion_config() -> Criterion {
    Criterion::default()
        .measurement_time(Duration::from_secs(1))
        .sample_size(10)
}

fn bench_document(c: &mut Criterion) {
    let mut group = c.benchmark_group("document");
    let (seed, cases) = cases();
    for (profile, size) in cases {
        let label = format!("{}/{}", profile.id, size);
        group.bench_function(BenchmarkId::new("load", &label), {
            let profile = profile.clone();
            move |b| {
                let fixture = fixture(&profile, size, seed);
                b.iter(|| {
                    let engine = TransactionEngine::load(black_box(&fixture.bytes), ActorId::from(ACTOR))
                        .expect("fixture loads");
                    black_box(engine);
                });
            }
        });
        group.bench_function(BenchmarkId::new("save", &label), {
            let profile = profile.clone();
            move |b| {
                let fixture = fixture(&profile, size, seed);
                b.iter_batched(
                    || fixture.engine.clone(),
                    |mut engine| black_box(engine.save().expect("fixture saves")),
                    BatchSize::SmallInput,
                );
            }
        });
        group.bench_function(BenchmarkId::new("materialize", &label), {
            move |b| {
                let fixture = fixture(&profile, size, seed);
                b.iter_batched(
                    || fixture.engine.clone(),
                    |mut engine| black_box(engine.snapshot().expect("fixture materializes")),
                    BatchSize::SmallInput,
                );
            }
        });
    }
    group.finish();
}

fn bench_transactions(c: &mut Criterion) {
    let mut group = c.benchmark_group("transactions");
    let (seed, cases) = cases();
    for (profile, size) in cases {
        let label = format!("{}/{}", profile.id, size);
        group.bench_function(BenchmarkId::new("commit", &label), {
            let profile = profile.clone();
            move |b| {
                let fixture = fixture(&profile, size, seed);
                b.iter_batched(
                    || fixture.engine.clone(),
                    |mut engine| {
                        let snapshot = engine.snapshot().expect("fixture materializes");
                        let shape_id = snapshot
                            .document
                            .shapes
                            .keys()
                            .next()
                            .expect("fixture has a shape")
                            .clone();
                        let transaction = patch_transaction(&snapshot, shape_id, 1);
                        black_box(engine.commit(transaction).expect("patch commits"));
                    },
                    BatchSize::SmallInput,
                );
            }
        });
        group.bench_function(BenchmarkId::new("undo-redo", &label), {
            move |b| {
                let fixture = fixture(&profile, size, seed);
                b.iter_batched(
                    || fixture.engine.clone(),
                    |mut engine| {
                        let snapshot = engine.snapshot().expect("fixture materializes");
                        let shape_id = snapshot
                            .document
                            .shapes
                            .keys()
                            .next()
                            .expect("fixture has a shape")
                            .clone();
                        let transaction = patch_transaction(&snapshot, shape_id, 2);
                        engine.commit(transaction).expect("patch commits");
                        engine.undo(&ActorId::from(ACTOR)).expect("commit undoes");
                        black_box(engine.redo(&ActorId::from(ACTOR)).expect("commit redoes"));
                    },
                    BatchSize::SmallInput,
                );
            }
        });
    }
    group.finish();
}

fn bench_queries(c: &mut Criterion) {
    let mut group = c.benchmark_group("queries");
    let (seed, cases) = cases();
    for (profile, size) in cases {
        let label = format!("{}/{}", profile.id, size);
        let query = Query {
            role: profile.metadata.then(|| "architecture.service".into()),
            tag: profile.metadata.then(|| "performance".into()),
            bounds: Some(Bounds { x: 0.0, y: 0.0, width: 3200.0, height: 3200.0 }),
            include_records: true,
            limit: Some(100),
            ..Query::default()
        };
        group.bench_function(BenchmarkId::new("query", &label), {
            move |b| {
                let fixture = fixture(&profile, size, seed);
                b.iter_batched(
                    || fixture.engine.clone(),
                    |mut engine| black_box(engine.query(black_box(&query)).expect("fixture queries")),
                    BatchSize::SmallInput,
                );
            }
        });
    }
    group.finish();
}

fn bench_svg_and_layout(c: &mut Criterion) {
    let mut svg_group = c.benchmark_group("svg");
    svg_group.bench_function("import/simple-github", |b| {
        b.iter(|| black_box(import_svg(black_box(SVG_FIXTURE)).expect("SVG fixture imports")));
    });
    let (svg_seed, svg_cases) = cases();
    for (profile, size) in svg_cases {
        let label = format!("{}/{}", profile.id, size);
        svg_group.bench_function(BenchmarkId::new("render", &label), {
            move |b| {
                let fixture = fixture(&profile, size, svg_seed);
                b.iter(|| {
                    black_box(
                        render_svg(black_box(&fixture.snapshot), &SvgRenderOptions::default())
                            .expect("fixture renders"),
                    )
                });
            }
        });
    }
    svg_group.finish();

    let mut layout_group = c.benchmark_group("layout");
    let (layout_seed, layout_cases) = cases();
    for (profile, size) in layout_cases {
        let label = format!("{}/{}", profile.id, size);
        layout_group.bench_function(BenchmarkId::new("flow", &label), {
            move |b| {
                let fixture = fixture(&profile, size, layout_seed);
                let graph = layout_graph_input(&fixture.document);
                b.iter(|| {
                    black_box(layout_graph(black_box(&graph), GraphLayoutOptions::default()).expect("graph lays out"))
                });
            }
        });
    }
    layout_group.finish();
}

fn bench_renderer_algorithms(c: &mut Criterion) {
    let mut group = c.benchmark_group("renderer-algorithms");
    let (seed, cases) = cases();
    for (profile, size) in cases {
        let label = format!("{}/{}", profile.id, size);
        group.bench_function(BenchmarkId::new("svg-scene", &label), {
            move |b| {
                let fixture = fixture(&profile, size, seed);
                let options = SvgRenderOptions {
                    region: Some(Bounds { x: 0.0, y: 0.0, width: 6400.0, height: 6400.0 }),
                    ..SvgRenderOptions::default()
                };
                b.iter(|| {
                    black_box(render_svg(black_box(&fixture.snapshot), black_box(&options)).expect("scene renders"))
                });
            }
        });
    }
    group.finish();
}

fn patch_transaction(snapshot: &inkfinite_core::DocumentSnapshot, shape_id: ShapeId, offset: i32) -> TransactionDraft {
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

fn layout_graph_input(document: &Document) -> GraphLayoutGraph {
    let mut nodes = Vec::with_capacity(document.shapes.len());
    for shape in document.shapes.values() {
        let bounds = inkfinite_core::engine::geometry::local_shape_bounds(shape);
        nodes.push(GraphLayoutNode {
            id: shape.id.clone(),
            width: bounds.width.max(1.0),
            height: bounds.height.max(1.0),
            locked: false,
        });
    }
    let edges = document
        .bindings
        .values()
        .map(|binding| GraphLayoutEdge {
            source: binding.source_shape_id.clone(),
            target: binding.target_shape_id.clone(),
        })
        .collect();
    GraphLayoutGraph { nodes, edges }
}

criterion_group! {
    name = performance;
    config = criterion_config();
    targets = bench_document, bench_transactions, bench_queries, bench_svg_and_layout, bench_renderer_algorithms
}
criterion_main!(performance);
