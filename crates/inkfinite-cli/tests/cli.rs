use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};

use inkfinite_core::file::DocumentFile;
use inkfinite_core::{
    ActorId, DocumentId, Opacity, Origin, Provenance, RecordVersion, SemanticMetadata, ShapeId, ShapeKind, ShapeParent,
    ShapeRecord, ShapeStyle, Timestamp, Transform, Vec2, blank_document,
};
use serde_json::Value;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn help_makes_common_tasks_and_support_paths_discoverable() {
    let no_arguments = run([]);
    assert_eq!(no_arguments.status.code(), Some(2));
    assert!(no_arguments.stdout.is_empty());
    let concise_help = String::from_utf8(no_arguments.stderr).unwrap();
    assert!(concise_help.contains("Work with Inkfinite documents from the command line"));
    assert!(concise_help.contains("inkfinite new architecture.inkfinite"));
    assert!(concise_help.contains("https://github.com/stormlightlabs/inkfinite/issues"));

    let query_help = run(["help", "query"]);
    assert_success(&query_help);
    let query_help = String::from_utf8(query_help.stdout).unwrap();
    assert!(query_help.contains("--bounds <X,Y,WIDTH,HEIGHT>"));
    assert!(query_help.contains("inkfinite query architecture.inkfinite --role architecture.service --json"));

    let version = run(["--version"]);
    assert_success(&version);
    assert_eq!(
        String::from_utf8(version.stdout).unwrap(),
        format!("inkfinite {}\n", env!("CARGO_PKG_VERSION"))
    );
}

#[test]
fn closed_file_workflow_has_stable_human_and_json_output() {
    let temporary = TestDirectory::new("workflow");
    let document_path = temporary.path.join("System Map.inkfinite");

    let created = run(["new", path(&document_path), "--json"]);
    assert_success(&created);
    let created_json = parse_stdout(&created);
    assert_eq!(created_json["document_id"], "document:system-map");
    assert_eq!(created_json["path"], document_path.to_string_lossy().replace('\\', "/"));
    assert!(created_json["heads"].as_array().is_some_and(|heads| !heads.is_empty()));

    let inspected = run(["inspect", path(&document_path), "--json"]);
    assert_success(&inspected);
    let inspected_json = parse_stdout(&inspected);
    assert_eq!(inspected_json["document_id"], "document:system-map");
    assert_eq!(inspected_json["heads"], created_json["heads"]);

    let globally_selected_json = run(["--json", "inspect", path(&document_path)]);
    assert_success(&globally_selected_json);
    assert_eq!(parse_stdout(&globally_selected_json), inspected_json);

    let queried = run([
        "query",
        path(&document_path),
        "--page",
        "page:document:system-map:1",
        "--json",
    ]);
    assert_success(&queried);
    let queried_json = parse_stdout(&queried);
    assert_eq!(queried_json["heads"], created_json["heads"]);
    assert_eq!(queried_json["records"][0]["kind"], "page");
    assert_eq!(queried_json["records"][1]["kind"], "layer");

    let validated = run(["validate", path(&document_path), "--json"]);
    assert_success(&validated);
    assert_eq!(parse_stdout(&validated)["valid"], true);

    let human = run(["inspect", path(&document_path)]);
    assert_success(&human);
    let stdout = String::from_utf8(human.stdout).unwrap();
    assert!(stdout.contains("Document: document:system-map"));
    assert!(stdout.contains("Heads:"));
    assert!(stdout.contains("Pages: 1"));
}

#[test]
fn query_forwards_semantic_hierarchy_kind_and_bounds_filters() {
    let temporary = TestDirectory::new("filters");
    let document_path = temporary.path.join("filters.inkfinite");
    let document_id = DocumentId::from("filters");
    let mut document = blank_document(&document_id, None);
    let page_id = document.page_ids[0].clone();
    let layer_id = document.pages[&page_id].layer_ids[0].clone();
    let shape_id = ShapeId::from("shape:api");
    let shape = ShapeRecord {
        id: shape_id.clone(),
        kind: ShapeKind::from("rect"),
        parent: ShapeParent::Layer(layer_id.clone()),
        transform: Transform { translation: Vec2 { x: 10.0, y: 20.0 }, rotation: 0.0, scale_x: 1.0, scale_y: 1.0 },
        child_ids: Vec::new(),
        layout: None,
        properties: BTreeMap::from([("width".into(), 40.0.into()), ("height".into(), 30.0.into())]),
        metadata: SemanticMetadata {
            name: Some("API".into()),
            role: Some("architecture.service".into()),
            description: None,
            tags: vec!["backend".into()],
            locked: false,
            agent_editable: true,
            provenance: Provenance {
                actor_id: ActorId::from("actor:test"),
                origin: Origin::Human,
                timestamp: Timestamp(1),
                source: None,
            },
        },
        style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
        version: RecordVersion(1),
    };
    document
        .layers
        .get_mut(&layer_id)
        .unwrap()
        .shape_ids
        .push(shape_id.clone());
    document.shapes.insert(shape_id, shape);
    drop(DocumentFile::create(&document_path, document_id, ActorId::from("actor:test"), document).unwrap());

    let output = run([
        "query",
        path(&document_path),
        "--name",
        "API",
        "--role",
        "architecture.service",
        "--tag",
        "backend",
        "--kind",
        "rect",
        "--page",
        "page:filters:1",
        "--layer",
        "layer:filters:1",
        "--parent",
        "layer:filters:1",
        "--bounds",
        "10,20,40,30",
        "--json",
    ]);
    assert_success(&output);
    let result = parse_stdout(&output);
    assert_eq!(result["records"].as_array().unwrap().len(), 1);
    assert_eq!(result["records"][0]["kind"], "shape");
    assert_eq!(result["records"][0]["id"], "shape:api");
    assert_eq!(result["bounds"]["shape:api"]["width"], 40.0);
}

#[test]
fn schemas_and_capabilities_match_checked_in_contracts() {
    let document_schema = run(["schema", "document"]);
    assert_success(&document_schema);
    assert_eq!(
        document_schema.stdout,
        include_bytes!("../../../schemas/document-snapshot.schema.json")
    );

    let transaction_schema = run(["schema", "transaction"]);
    assert_success(&transaction_schema);
    assert_eq!(
        transaction_schema.stdout,
        include_bytes!("../../../schemas/transaction-draft.schema.json")
    );

    let protocol = run(["schema", "protocol"]);
    assert_success(&protocol);
    let protocol_json = parse_stdout(&protocol);
    let expected_request: Value =
        serde_json::from_slice(include_bytes!("../../../schemas/protocol-request.schema.json")).unwrap();
    let expected_response: Value =
        serde_json::from_slice(include_bytes!("../../../schemas/protocol-response.schema.json")).unwrap();
    let expected_error: Value =
        serde_json::from_slice(include_bytes!("../../../schemas/protocol-error.schema.json")).unwrap();
    assert_eq!(protocol_json["request"], expected_request);
    assert_eq!(protocol_json["response"], expected_response);
    assert_eq!(protocol_json["error"], expected_error);

    let capabilities = run(["capabilities", "--json"]);
    assert_success(&capabilities);
    let capabilities_json = parse_stdout(&capabilities);
    assert_eq!(capabilities_json["exit_codes"]["usage"], 2);
    assert_eq!(capabilities_json["exit_codes"]["input"], 3);
    assert_eq!(
        capabilities_json["global_options"],
        serde_json::json!(["--json", "--non-interactive"])
    );
    assert_eq!(capabilities_json["path_format"], "forward_slashes");
    assert_eq!(capabilities_json["format"]["id"], "inkfinite.document");
    assert_eq!(capabilities_json["protocol"]["id"], "inkfinite.protocol");
}

#[test]
fn json_failures_keep_stdout_clean_and_use_stable_exit_codes() {
    let temporary = TestDirectory::new("failures");
    let missing = temporary.path.join("missing.inkfinite");

    let missing_output = run(["inspect", path(&missing), "--json"]);
    assert_eq!(missing_output.status.code(), Some(3));
    assert!(missing_output.stdout.is_empty());
    let diagnostic = String::from_utf8(missing_output.stderr).unwrap();
    assert!(diagnostic.starts_with("inkfinite: could not open"));
    assert!(diagnostic.contains("read canonical document"));

    let document = temporary.path.join("existing.inkfinite");
    assert_success(&run(["new", path(&document), "--json"]));
    let conflict = run(["new", path(&document), "--json"]);
    assert_eq!(conflict.status.code(), Some(5));
    assert!(conflict.stdout.is_empty());

    let usage = run(["query", path(&document), "--bounds", "1,2,3", "--json"]);
    assert_eq!(usage.status.code(), Some(2));
    assert!(usage.stdout.is_empty());
}

fn run<const N: usize>(args: [&str; N]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_inkfinite"))
        .args(args)
        .output()
        .unwrap()
}

fn path(path: &Path) -> &str {
    path.to_str().unwrap()
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "command failed with {:?}: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "unexpected stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn parse_stdout(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap()
}

struct TestDirectory {
    path: PathBuf,
}

impl TestDirectory {
    fn new(name: &str) -> Self {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("inkfinite-cli-{name}-{}-{sequence}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
