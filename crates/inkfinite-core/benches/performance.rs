use std::fmt::Write as _;
use std::hint::black_box;
use std::time::Duration;

use criterion::{BatchSize, BenchmarkId, Criterion, criterion_group, criterion_main};
use inkfinite_core::engine::{TransactionEngine, geometry::local_shape_bounds, validate_document};
use inkfinite_core::graph_layout::{
    GraphLayoutEdge, GraphLayoutGraph, GraphLayoutNode, GraphLayoutOptions, layout_graph,
};
use inkfinite_core::performance::{PerformanceFixture, cases, fixture, patch_transaction};
use inkfinite_core::proto::{Bounds, Query};
use inkfinite_core::render::{SvgRenderOptions, render_svg};
use inkfinite_core::svg_import::import_svg;
use inkfinite_core::{ActorId, Document};

const SVG_FIXTURE: &str = include_str!("../../../fixtures/svg-import/icons/simple-github.svg");
const REMOTE_ACTOR: &str = "actor:criterion-merge";

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
                    let engine = TransactionEngine::load(
                        black_box(&fixture.bytes),
                        ActorId::from(inkfinite_core::performance::ACTOR),
                    )
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
            let profile = profile.clone();
            move |b| {
                let fixture = fixture(&profile, size, seed);
                b.iter_batched(
                    || fixture.engine.clone(),
                    |mut engine| black_box(engine.snapshot().expect("fixture materializes")),
                    BatchSize::SmallInput,
                );
            }
        });
        group.bench_function(BenchmarkId::new("validate", &label), {
            let profile = profile.clone();
            move |b| {
                let fixture = fixture(&profile, size, seed);
                b.iter(|| {
                    validate_document(black_box(&fixture.document)).expect("fixture validates");
                    black_box(())
                });
            }
        });
    }
    group.finish();
}

fn bench_transactions(c: &mut Criterion) {
    let mut group = c.benchmark_group("transactions");
    let (seed, transaction_cases) = cases();
    for (profile, size) in transaction_cases {
        let label = format!("{}/{}", profile.id, size);
        group.bench_function(BenchmarkId::new("commit", &label), {
            let profile = profile.clone();
            move |b| {
                let fixture = fixture(&profile, size, seed);
                let shape_id = fixture
                    .snapshot
                    .document
                    .shapes
                    .keys()
                    .next()
                    .expect("fixture has a shape")
                    .clone();
                let transaction = patch_transaction(&fixture.snapshot, shape_id, 1);
                b.iter_batched(
                    || (fixture.engine.clone(), transaction.clone()),
                    |(mut engine, transaction)| black_box(engine.commit(transaction).expect("patch commits")),
                    BatchSize::SmallInput,
                );
            }
        });
        group.bench_function(BenchmarkId::new("undo", &label), {
            let profile = profile.clone();
            move |b| {
                let fixture = fixture(&profile, size, seed);
                let shape_id = fixture
                    .snapshot
                    .document
                    .shapes
                    .keys()
                    .next()
                    .expect("fixture has a shape")
                    .clone();
                let transaction = patch_transaction(&fixture.snapshot, shape_id, 1);
                b.iter_batched(
                    || {
                        let mut engine = fixture.engine.clone();
                        engine.commit(transaction.clone()).expect("patch commits");
                        engine
                    },
                    |mut engine| {
                        black_box(
                            engine
                                .undo(&ActorId::from(inkfinite_core::performance::ACTOR))
                                .expect("commit undoes"),
                        );
                    },
                    BatchSize::SmallInput,
                );
            }
        });
        group.bench_function(BenchmarkId::new("redo", &label), {
            move |b| {
                let fixture = fixture(&profile, size, seed);
                let shape_id = fixture
                    .snapshot
                    .document
                    .shapes
                    .keys()
                    .next()
                    .expect("fixture has a shape")
                    .clone();
                let transaction = patch_transaction(&fixture.snapshot, shape_id, 1);
                b.iter_batched(
                    || {
                        let mut engine = fixture.engine.clone();
                        engine.commit(transaction.clone()).expect("patch commits");
                        engine
                            .undo(&ActorId::from(inkfinite_core::performance::ACTOR))
                            .expect("commit undoes");
                        engine
                    },
                    |mut engine| {
                        black_box(
                            engine
                                .redo(&ActorId::from(inkfinite_core::performance::ACTOR))
                                .expect("commit redoes"),
                        );
                    },
                    BatchSize::SmallInput,
                );
            }
        });
    }
    group.finish();
}

fn bench_merge(c: &mut Criterion) {
    let mut group = c.benchmark_group("merge");
    let (seed, cases) = cases();
    for (profile, size) in cases {
        let label = format!("{}/{}", profile.id, size);
        group.bench_function(BenchmarkId::new("remote-change", &label), {
            let profile = profile.clone();
            move |b| {
                let fixture = fixture(&profile, size, seed);
                let changes = remote_changes(&fixture);
                b.iter_batched(
                    || (fixture.engine.clone(), changes.clone()),
                    |(mut engine, changes)| black_box(engine.merge_changes(&changes).expect("fixture merges")),
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
    for size in [100, 1_000, 5_000, 10_000] {
        let source = generated_svg_fixture(size);
        svg_group.bench_function(BenchmarkId::new("import/generated", size), move |b| {
            b.iter(|| black_box(import_svg(black_box(&source)).expect("generated SVG fixture imports")));
        });
    }

    let (seed, svg_cases) = cases();
    for (profile, size) in svg_cases {
        let label = format!("{}/{}", profile.id, size);
        svg_group.bench_function(BenchmarkId::new("render", &label), {
            move |b| {
                let fixture = fixture(&profile, size, seed);
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

fn remote_changes(fixture: &PerformanceFixture) -> Vec<inkfinite_core::crdt::EncodedChange> {
    let remote_actor = ActorId::from(REMOTE_ACTOR);
    let mut remote = TransactionEngine::load(&fixture.bytes, remote_actor.clone()).expect("remote fixture loads");
    let snapshot = remote.snapshot().expect("remote fixture materializes");
    let shape_id = snapshot
        .document
        .shapes
        .keys()
        .next()
        .expect("remote fixture has a shape")
        .clone();
    let mut transaction = patch_transaction(&snapshot, shape_id, 3);
    transaction.actor_id = remote_actor;
    transaction.id = inkfinite_core::proto::TransactionId("transaction:criterion:merge".into());
    remote.commit(transaction).expect("remote patch commits");
    remote
        .changes_since(&fixture.snapshot.heads)
        .expect("remote changes are available")
}

fn generated_svg_fixture(size: usize) -> String {
    let mut svg = String::with_capacity(size * 100 + 128);
    svg.push_str(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8000 8000"><g>"#);
    for index in 0..size {
        let x = (index % 100) * 80;
        let y = (index / 100) * 80;
        let _ = write!(
            svg,
            r##"<rect x="{x}" y="{y}" width="48" height="40" fill="#dbeafe"/>"##
        );
    }
    svg.push_str("</g></svg>");
    svg
}

fn layout_graph_input(document: &Document) -> GraphLayoutGraph {
    let mut nodes = Vec::with_capacity(document.shapes.len());
    for shape in document.shapes.values() {
        let bounds = local_shape_bounds(shape);
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
    targets = bench_document, bench_transactions, bench_merge, bench_queries, bench_svg_and_layout, bench_renderer_algorithms
}
criterion_main!(performance);
