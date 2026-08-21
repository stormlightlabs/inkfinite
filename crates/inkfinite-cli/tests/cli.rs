use std::collections::BTreeMap;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
#[cfg(unix)]
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(unix)]
use std::thread;

use inkfinite_core::file::DocumentFile;
#[cfg(unix)]
use inkfinite_core::ipc::{
    self, AppRequest, AppResponse, DiscoveryRecord, RequestEnvelope, RequestGuard, ResponseEnvelope,
};
use inkfinite_core::proto::{Operation, TransactionDraft, TransactionId};
#[cfg(unix)]
use inkfinite_core::session::EditorContextUpdate;
use inkfinite_core::{
    ActorId, DocumentId, Opacity, Origin, Provenance, RecordVersion, SemanticMetadata, ShapeId, ShapeKind, ShapeParent,
    ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform, Vec2, blank_document,
};
use serde_json::{Value, json};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
#[cfg(unix)]
static IPC_TEST_LOCK: Mutex<()> = Mutex::new(());

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

    let app_query_help = run(["help", "app", "query"]);
    assert_success(&app_query_help);
    let app_query_help = String::from_utf8(app_query_help.stdout).unwrap();
    assert!(app_query_help.contains("inkfinite app query --role architecture.service --json"));
    assert!(app_query_help.contains("--session-id <SESSION_ID>"));

    let version = run(["--version"]);
    assert_success(&version);
    assert_eq!(
        String::from_utf8(version.stdout).unwrap(),
        format!("inkfinite {}\n", env!("CARGO_PKG_VERSION"))
    );

    let agent_review_attempt = run(["app", "accept", "--proposal-id", "proposal:1", "--json"]);
    assert_eq!(agent_review_attempt.status.code(), Some(2));
    assert_eq!(parse_stderr(&agent_review_attempt)["error"]["code"], "invalid_usage");
}

#[test]
fn closed_file_workflow_has_stable_human_and_json_output() {
    let temporary = TestDirectory::new("workflow");
    let document_path = temporary.path.join("System Map.inkfinite");

    let created = run(["new", path(&document_path), "--json"]);
    assert_success(&created);
    let created_json = parse_stdout(&created);
    assert_eq!(created_json["document_id"], "document:system-map");
    assert_eq!(created_json["page_id"], "page:document:system-map:1");
    assert_eq!(created_json["layer_id"], "layer:document:system-map:1");
    assert_eq!(created_json["path"], document_path.to_string_lossy().replace('\\', "/"));
    assert!(created_json["heads"].as_array().is_some_and(|heads| !heads.is_empty()));

    let inspected = run(["inspect", path(&document_path), "--json"]);
    assert_success(&inspected);
    let inspected_json = parse_stdout(&inspected);
    assert_eq!(inspected_json["document_id"], "document:system-map");
    assert_eq!(inspected_json["heads"], created_json["heads"]);

    let summary = parse_stdout(&run(["inspect", path(&document_path), "--summary", "--json"]));
    assert_eq!(summary["counts"]["pages"], 1);
    assert_eq!(summary["counts"]["layers"], 1);
    assert!(summary.get("document").is_none());

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
fn svg_import_is_one_atomic_transaction_with_dry_run_support() {
    let temporary = TestDirectory::new("svg-import");
    let document_path = temporary.path.join("import.inkfinite");
    let svg_path = temporary.path.join("icon.svg");
    fs::write(
        &svg_path,
        r#"<svg viewBox="0 0 100 80"><g id="mark"><rect id="box" width="20" height="30"/><path d="M0 0 L10 10 Z"/></g></svg>"#,
    )
    .unwrap();
    assert_success(&run(["new", path(&document_path), "--json"]));
    let before = fs::read(&document_path).unwrap();

    let dry_run = run([
        "import",
        "svg",
        path(&document_path),
        "--input",
        path(&svg_path),
        "--dry-run",
        "--json",
    ]);
    assert_success(&dry_run);
    let dry_run_json = parse_stdout(&dry_run);
    assert_eq!(dry_run_json["dry_run"], true);
    assert_eq!(dry_run_json["created"].as_array().unwrap().len(), 5);
    assert_eq!(fs::read(&document_path).unwrap(), before);

    let imported = run([
        "import",
        "svg",
        path(&document_path),
        "--input",
        path(&svg_path),
        "--json",
    ]);
    assert_success(&imported);
    let imported_json = parse_stdout(&imported);
    assert_eq!(imported_json["warnings"].as_array().unwrap().len(), 0);
    let summary = parse_stdout(&run(["inspect", path(&document_path), "--summary", "--json"]));
    assert_eq!(summary["counts"]["assets"], 1);
    assert_eq!(summary["counts"]["shapes"], 4);
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
        "--detail",
        "--limit",
        "1",
        "--json",
    ]);
    assert_success(&output);
    let result = parse_stdout(&output);
    assert_eq!(result["records"].as_array().unwrap().len(), 1);
    assert_eq!(result["records"][0]["kind"], "shape");
    assert_eq!(result["records"][0]["id"], "shape:api");
    assert_eq!(result["bounds"]["shape:api"]["width"], 40.0);
    assert_eq!(result["details"][0]["kind"], "shape");
    assert_eq!(result["details"][0]["record"]["version"], 1);
    assert_eq!(result["total"], 1);
    assert_eq!(result["truncated"], false);
}

#[test]
fn shape_discovery_and_transaction_output_are_agent_friendly() {
    let temporary = TestDirectory::new("transaction-output");
    let document_path = temporary.path.join("output.inkfinite");
    let transaction_path = temporary.path.join("create.json");
    assert_success(&run(["new", path(&document_path), "--json"]));
    let original = fs::read(&document_path).unwrap();

    let kinds = parse_stdout(&run(["shape", "kinds", "--json"]));
    assert!(kinds.as_array().unwrap().iter().any(|kind| kind["kind"] == "rect"));
    let described = parse_stdout(&run(["shape", "describe", "container", "--json"]));
    assert_eq!(described["allows_children"], true);

    let emitted = run([
        "shape",
        "create",
        path(&document_path),
        "--kind",
        "rect",
        "--layer",
        "layer:document:output:1",
        "--properties",
        "{\"width\":40,\"height\":30}",
        "--transaction-out",
        path(&transaction_path),
        "--json",
    ]);
    assert_success(&emitted);
    let emitted_json = parse_stdout(&emitted);
    assert_eq!(emitted_json["dry_run"], true);
    assert_eq!(fs::read(&document_path).unwrap(), original);
    let transaction: TransactionDraft = serde_json::from_slice(&fs::read(&transaction_path).unwrap()).unwrap();
    let Operation::CreateShape { shape, .. } = &transaction.operations[0] else {
        panic!("structured create should emit a create-shape operation")
    };
    assert_eq!(shape.id.as_str(), "shape:rect:1");
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
    assert!(
        capabilities_json["commands"]
            .as_array()
            .unwrap()
            .contains(&Value::String("app".into()))
    );
    assert_eq!(
        capabilities_json["live_mode"]["transport"],
        "authenticated_local_socket"
    );
    assert_eq!(capabilities_json["live_mode"]["tcp_or_http"], false);
    assert_eq!(
        capabilities_json["mutation_commands"]["structured_targets"],
        json!(["file", "app"])
    );
    assert_eq!(
        capabilities_json["query_options"],
        serde_json::json!(["detail", "limit"])
    );
    assert_eq!(capabilities_json["mutation_commands"]["shape"][0], "create");
    assert!(
        capabilities_json["commands"]
            .as_array()
            .unwrap()
            .contains(&Value::String("render".into()))
    );
}

#[test]
fn apply_dry_run_then_save_validate_reopen_and_render_is_atomic() {
    let temporary = TestDirectory::new("apply-render");
    let document_path = temporary.path.join("workflow.inkfinite");
    let transaction_path = temporary.path.join("transaction.json");
    assert_success(&run(["new", path(&document_path), "--json"]));
    let inspected = parse_stdout(&run(["inspect", path(&document_path), "--json"]));
    let original = fs::read(&document_path).unwrap();
    let transaction = TransactionDraft {
        id: TransactionId("transaction:add-service".into()),
        actor_id: ActorId::from("actor:inkfinite-cli"),
        origin: Origin::Agent,
        base_heads: serde_json::from_value(inspected["heads"].clone()).unwrap(),
        description: "add service".into(),
        operations: vec![Operation::CreateShape {
            shape: ShapeRecord {
                id: ShapeId::from("shape:service"),
                kind: ShapeKind::from("rect"),
                parent: ShapeParent::Layer("layer:document:workflow:1".into()),
                transform: Transform {
                    translation: Vec2 { x: 10.0, y: 10.0 },
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                },
                child_ids: Vec::new(),
                layout: None,
                properties: BTreeMap::from([("width".into(), 40.0.into()), ("height".into(), 30.0.into())]),
                metadata: SemanticMetadata {
                    name: None,
                    role: Some("architecture.service".into()),
                    description: None,
                    tags: Vec::new(),
                    locked: false,
                    agent_editable: true,
                    provenance: Provenance {
                        actor_id: ActorId::from("actor:inkfinite-cli"),
                        origin: Origin::Agent,
                        timestamp: Timestamp(0),
                        source: None,
                    },
                },
                style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
                version: RecordVersion(1),
            },
            anchor: SiblingAnchor::Last,
        }],
        timestamp: Timestamp(0),
    };
    let transaction_json = serde_json::to_vec_pretty(&transaction).unwrap();
    fs::write(&transaction_path, &transaction_json).unwrap();

    let mut child = Command::new(env!("CARGO_BIN_EXE_inkfinite"))
        .args([
            "apply",
            path(&document_path),
            "--transaction",
            "-",
            "--dry-run",
            "--json",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.as_mut().unwrap().write_all(&transaction_json).unwrap();
    let dry_run = child.wait_with_output().unwrap();
    assert_success(&dry_run);
    let dry_run = parse_stdout(&dry_run);
    assert_eq!(dry_run["dry_run"], true);
    assert_eq!(dry_run["transaction_id"], "transaction:add-service");
    assert_eq!(dry_run["created"][0]["kind"], "shape");
    assert_eq!(fs::read(&document_path).unwrap(), original);

    let applied = run([
        "--json",
        "apply",
        path(&document_path),
        "--transaction",
        path(&transaction_path),
    ]);
    assert_success(&applied);
    let applied = parse_stdout(&applied);
    assert_eq!(applied["previous_heads"], inspected["heads"]);
    assert_ne!(applied["current_heads"], inspected["heads"]);

    let saved = fs::read(&document_path).unwrap();
    let stale = run([
        "apply",
        path(&document_path),
        "--transaction",
        path(&transaction_path),
        "--json",
    ]);
    assert_eq!(stale.status.code(), Some(5));
    assert!(stale.stdout.is_empty());
    assert_eq!(fs::read(&document_path).unwrap(), saved);
}

#[test]
fn shape_create_places_new_shapes_relative_to_semantic_targets() {
    let temporary = TestDirectory::new("semantic-placement");
    let document_path = temporary.path.join("placement.inkfinite");
    assert_success(&run(["new", path(&document_path), "--json"]));
    assert_success(&run([
        "shape",
        "create",
        path(&document_path),
        "--shape-id",
        "shape:target",
        "--kind",
        "rect",
        "--layer",
        "layer:document:placement:1",
        "--x",
        "10",
        "--y",
        "20",
        "--properties",
        r#"{"width":40,"height":20}"#,
        "--role",
        "layout.target",
        "--json",
    ]));
    let placed = run([
        "shape",
        "create",
        path(&document_path),
        "--shape-id",
        "shape:placed",
        "--kind",
        "rect",
        "--properties",
        r#"{"width":20,"height":10}"#,
        "--relative-role",
        "layout.target",
        "--placement",
        "below",
        "--gap",
        "12",
        "--json",
    ]);
    assert_success(&placed);

    let snapshot = parse_stdout(&run(["inspect", path(&document_path), "--json"]));
    assert_eq!(
        snapshot["document"]["shapes"]["shape:placed"]["transform"]["translation"],
        json!({ "x": 10.0, "y": 52.0 })
    );
    assert_eq!(
        snapshot["document"]["shapes"]["shape:placed"]["parent"],
        json!({ "kind": "layer", "id": "layer:document:placement:1" })
    );
}

#[test]
fn structured_create_can_be_validated_reopened_and_rendered() {
    let temporary = TestDirectory::new("render");
    let document_path = temporary.path.join("render.inkfinite");
    let svg_path = temporary.path.join("render.svg");
    let png_path = temporary.path.join("render.png");
    assert_success(&run(["new", path(&document_path), "--json"]));
    assert_success(&run([
        "shape",
        "create",
        path(&document_path),
        "--shape-id",
        "shape:service",
        "--kind",
        "rect",
        "--layer",
        "layer:document:render:1",
        "--x",
        "-20",
        "--y",
        "-15",
        "--properties",
        "{\"width\":40,\"height\":30}",
        "--role",
        "architecture.service",
        "--json",
    ]));
    assert_success(&run(["validate", path(&document_path), "--json"]));
    let reopened = parse_stdout(&run([
        "query",
        path(&document_path),
        "--role",
        "architecture.service",
        "--json",
    ]));
    assert_eq!(reopened["records"][0]["id"], "shape:service");

    let rendered = run([
        "render",
        path(&document_path),
        "--output",
        path(&svg_path),
        "--role",
        "architecture.service",
        "--json",
    ]);
    assert_success(&rendered);
    assert_eq!(
        parse_stdout(&rendered)["output"],
        svg_path.to_string_lossy().replace('\\', "/")
    );
    let svg = fs::read_to_string(&svg_path).unwrap();
    assert!(svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""));
    assert!(svg.contains("data-shape-id=\"shape:service\""));

    let rendered_png = run([
        "render",
        path(&document_path),
        "--output",
        path(&png_path),
        "--role",
        "architecture.service",
        "--json",
    ]);
    assert_success(&rendered_png);
    assert_eq!(
        parse_stdout(&rendered_png)["output"],
        png_path.to_string_lossy().replace('\\', "/")
    );
    let png = fs::read(&png_path).unwrap();
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");

    let unsupported_path = temporary.path.join("render.pdf");
    let unsupported = run([
        "render",
        path(&document_path),
        "--output",
        path(&unsupported_path),
        "--json",
    ]);
    assert_eq!(unsupported.status.code(), Some(3));
    assert_eq!(parse_stderr(&unsupported)["error"]["code"], "render_output_format");
    assert!(!unsupported_path.exists());

    let canonical = fs::read(&document_path).unwrap();
    let same_path = run([
        "render",
        path(&document_path),
        "--output",
        path(&document_path),
        "--json",
    ]);
    assert_eq!(same_path.status.code(), Some(5));
    assert!(same_path.stdout.is_empty());
    assert_eq!(fs::read(&document_path).unwrap(), canonical);
}

#[test]
fn structured_commands_use_semantic_selectors_for_layout_and_connections() {
    let temporary = TestDirectory::new("structured");
    let document_path = temporary.path.join("structured.inkfinite");
    assert_success(&run(["new", path(&document_path), "--json"]));
    let layer_id = "layer:document:structured:1";

    for (id, role, x) in [
        ("shape:one", "architecture.service", "0"),
        ("shape:two", "architecture.service", "100"),
        ("shape:three", "architecture.service", "240"),
        ("shape:arrow", "architecture.connector", "20"),
    ] {
        let created = run([
            "shape",
            "create",
            path(&document_path),
            "--shape-id",
            id,
            "--kind",
            if id == "shape:arrow" { "arrow" } else { "rect" },
            "--layer",
            layer_id,
            "--x",
            x,
            "--properties",
            "{\"width\":40,\"height\":30}",
            "--role",
            role,
            "--json",
        ]);
        assert_success(&created);
    }

    let aligned = run([
        "layout",
        "align",
        path(&document_path),
        "--role",
        "architecture.service",
        "--alignment",
        "top",
        "--json",
    ]);
    assert_success(&aligned);
    assert_eq!(parse_stdout(&aligned)["updated"].as_array().unwrap().len(), 3);

    let distributed = run([
        "layout",
        "distribute",
        path(&document_path),
        "--role",
        "architecture.service",
        "--axis",
        "horizontal",
        "--json",
    ]);
    assert_success(&distributed);

    let connected = run([
        "connect",
        path(&document_path),
        "--binding-id",
        "binding:arrow-target",
        "--source-role",
        "architecture.connector",
        "--target",
        "shape:one",
        "--json",
    ]);
    assert_success(&connected);
    assert_eq!(parse_stdout(&connected)["created"][0]["kind"], "binding");
}

#[test]
fn failed_validation_permissions_and_locks_leave_canonical_bytes_unchanged() {
    let temporary = TestDirectory::new("mutation-failures");
    let document_path = temporary.path.join("failures.inkfinite");
    assert_success(&run(["new", path(&document_path), "--json"]));
    let layer_id = "layer:document:failures:1";
    let original = fs::read(&document_path).unwrap();
    let invalid = run([
        "shape",
        "create",
        path(&document_path),
        "--shape-id",
        "shape:invalid",
        "--kind",
        "rect",
        "--layer",
        layer_id,
        "--properties",
        "{\"width\":-1,\"height\":30}",
        "--json",
    ]);
    assert_eq!(invalid.status.code(), Some(4));
    assert!(invalid.stdout.is_empty());
    assert_eq!(fs::read(&document_path).unwrap(), original);

    assert_success(&run([
        "shape",
        "create",
        path(&document_path),
        "--shape-id",
        "shape:locked",
        "--kind",
        "rect",
        "--layer",
        layer_id,
        "--properties",
        "{\"width\":40,\"height\":30}",
        "--name",
        "Locked",
        "--locked",
        "--json",
    ]));

    let before_rejection = fs::read(&document_path).unwrap();
    let rejected = run(["shape", "delete", path(&document_path), "--name", "Locked", "--json"]);
    assert_eq!(rejected.status.code(), Some(5));
    assert!(rejected.stdout.is_empty());
    assert_eq!(fs::read(&document_path).unwrap(), before_rejection);

    let held = DocumentFile::open(&document_path, ActorId::from("actor:lock-holder")).unwrap();
    let locked = run([
        "shape",
        "create",
        path(&document_path),
        "--shape-id",
        "shape:blocked-by-file-lock",
        "--kind",
        "rect",
        "--layer",
        layer_id,
        "--json",
    ]);
    assert_eq!(locked.status.code(), Some(5));
    assert!(locked.stdout.is_empty());
    drop(held);
    assert_eq!(fs::read(&document_path).unwrap(), before_rejection);
}

#[test]
fn json_failures_keep_stdout_clean_and_use_stable_exit_codes() {
    let temporary = TestDirectory::new("failures");
    let missing = temporary.path.join("missing.inkfinite");

    let missing_output = run(["inspect", path(&missing), "--json"]);
    assert_eq!(missing_output.status.code(), Some(3));
    assert!(missing_output.stdout.is_empty());
    let diagnostic = String::from_utf8(missing_output.stderr).unwrap();
    let diagnostic: Value = serde_json::from_str(&diagnostic).unwrap();
    assert_eq!(diagnostic["error"]["code"], "file_io_error");
    assert!(
        diagnostic["error"]["message"]
            .as_str()
            .unwrap()
            .contains("could not open")
    );

    let document = temporary.path.join("existing.inkfinite");
    assert_success(&run(["new", path(&document), "--json"]));
    let conflict = run(["new", path(&document), "--json"]);
    assert_eq!(conflict.status.code(), Some(5));
    assert!(conflict.stdout.is_empty());

    let usage = run(["query", path(&document), "--bounds", "1,2,3", "--json"]);
    assert_eq!(usage.status.code(), Some(2));
    assert!(usage.stdout.is_empty());
    assert_eq!(parse_stderr(&usage)["error"]["code"], "invalid_usage");
}

#[cfg(unix)]
#[test]
fn live_commands_read_shared_records_from_the_authenticated_local_server() {
    use std::os::unix::fs::FileTypeExt;
    use std::os::unix::net::{UnixListener, UnixStream};

    use inkfinite_core::proto::QueryResult;

    let _guard = IPC_TEST_LOCK.lock().unwrap();
    ipc::ensure_ipc_directory().unwrap();
    let endpoint = ipc::endpoint_name();
    let endpoint_path = Path::new(&endpoint);
    if UnixStream::connect(endpoint_path).is_ok() {
        return;
    }
    if let Ok(metadata) = fs::symlink_metadata(endpoint_path) {
        if !metadata.file_type().is_socket() {
            return;
        }
        fs::remove_file(endpoint_path).unwrap();
    }

    let temporary = TestDirectory::new("live-ipc");
    let document_path = temporary.path.join("live.inkfinite");
    let document_id = DocumentId::from("document:live-ipc");
    let document = blank_document(&document_id, Some("Live"));
    let mut file = DocumentFile::create(&document_path, document_id, ActorId::from("actor:test"), document).unwrap();
    let snapshot = file.snapshot().unwrap();
    drop(file);

    let previous_discovery = ipc::read_discovery(&ipc::discovery_path()).ok();
    let discovery = DiscoveryRecord {
        protocol_id: inkfinite_core::proto::PROTOCOL_ID.into(),
        version: inkfinite_core::proto::PROTOCOL_VERSION,
        endpoint: endpoint.clone(),
        token: "cli-ipc-test-token".into(),
    };
    let listener = UnixListener::bind(endpoint_path).unwrap();
    listener.set_nonblocking(true).unwrap();
    ipc::write_discovery(&ipc::discovery_path(), &discovery).unwrap();

    let server_snapshot = snapshot.clone();
    let server_token = discovery.token.clone();
    let server = thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::UnixListener::from_std(listener).unwrap();
            for _ in 0..4 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let request = ipc::read_frame::<RequestEnvelope>(&mut stream).await.unwrap();
                assert_eq!(request.token, server_token);
                let request_id = request.request_id;
                let response = match request.request {
                    AppRequest::Status => AppResponse::Status(Vec::new()),
                    AppRequest::Inspect { .. } => AppResponse::Snapshot(server_snapshot.clone()),
                    AppRequest::Query { .. } => AppResponse::QueryResult(QueryResult {
                        heads: server_snapshot.heads.clone(),
                        records: Vec::new(),
                        bounds: BTreeMap::new(),
                        details: Vec::new(),
                        total: 0,
                        truncated: false,
                    }),
                    AppRequest::Focus => AppResponse::Focused,
                    AppRequest::Context { .. }
                    | AppRequest::Render { .. }
                    | AppRequest::Ui { .. }
                    | AppRequest::Apply { .. } => {
                        panic!("proposal requests are outside this IPC fixture")
                    }
                };
                ipc::write_frame(&mut stream, &ResponseEnvelope { request_id, result: Ok(response) })
                    .await
                    .unwrap();
            }
        });
    });

    let status = run(["app", "status", "--json"]);
    let inspected = run(["app", "inspect", "--json"]);
    let queried = run(["app", "query", "--json"]);
    let focused = run(["app", "focus"]);
    server.join().unwrap();

    let _ = ipc::remove_discovery(&ipc::discovery_path(), &discovery);
    let _ = fs::remove_file(endpoint_path);
    if let Some(previous) = previous_discovery {
        ipc::write_discovery(&ipc::discovery_path(), &previous).unwrap();
    }

    assert_success(&status);
    assert_eq!(parse_stdout(&status), Value::Array(Vec::new()));
    assert_success(&inspected);
    assert_eq!(
        parse_stdout(&inspected),
        serde_json::to_value(snapshot.clone()).unwrap()
    );
    assert_success(&queried);
    assert_eq!(
        parse_stdout(&queried)["heads"],
        serde_json::to_value(snapshot.heads).unwrap()
    );
    assert_success(&focused);
    assert!(
        String::from_utf8(focused.stdout)
            .unwrap()
            .contains("Desktop focus requested")
    );
}

#[cfg(unix)]
#[test]
#[allow(clippy::too_many_lines)]
fn live_structured_edits_apply_without_permission_mode() {
    use std::os::unix::fs::FileTypeExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::mpsc;

    use inkfinite_core::proto::ProtocolError;
    use inkfinite_core::session::SessionService;

    let _guard = IPC_TEST_LOCK.lock().unwrap();
    ipc::ensure_ipc_directory().unwrap();
    let endpoint = ipc::endpoint_name();
    let endpoint_path = Path::new(&endpoint);
    if UnixStream::connect(endpoint_path).is_ok() {
        return;
    }
    if let Ok(metadata) = fs::symlink_metadata(endpoint_path) {
        if !metadata.file_type().is_socket() {
            return;
        }
        fs::remove_file(endpoint_path).unwrap();
    }

    let temporary = TestDirectory::new("live-proposals");
    let document_path = temporary.path.join("live.inkfinite");
    let transaction_path = temporary.path.join("transaction.json");
    let live_svg_path = temporary.path.join("live.svg");
    let document_id = DocumentId::from("document:live-proposals");
    let actor = ActorId::from("actor:live-proposals");
    let document = blank_document(&document_id, Some("Live proposals"));
    let mut file = DocumentFile::create(&document_path, document_id, actor.clone(), document).unwrap();
    let snapshot = file.snapshot().unwrap();
    drop(file);

    let page_id = snapshot.document.page_ids[0].clone();
    let layer_id = snapshot.document.pages[&page_id].layer_ids[0].clone();

    let mut service = SessionService::new();
    let opened = service.open(&document_path, actor.clone()).unwrap();
    let session_id = opened.session_id;
    service
        .update_context(
            &session_id,
            EditorContextUpdate {
                page_id: Some(page_id.clone()),
                active_layer_id: Some(layer_id.clone()),
                selection_ids: Vec::new(),
                viewport: Some(inkfinite_core::proto::Bounds { x: -50.0, y: -25.0, width: 100.0, height: 50.0 }),
                camera: None,
                occluded_regions: Vec::new(),
            },
        )
        .unwrap();

    let previous_discovery = ipc::read_discovery(&ipc::discovery_path()).ok();
    let discovery = DiscoveryRecord {
        protocol_id: inkfinite_core::proto::PROTOCOL_ID.into(),
        version: inkfinite_core::proto::PROTOCOL_VERSION,
        endpoint: endpoint.clone(),
        token: "cli-proposal-test-token".into(),
    };
    let listener = UnixListener::bind(endpoint_path).unwrap();
    listener.set_nonblocking(true).unwrap();
    ipc::write_discovery(&ipc::discovery_path(), &discovery).unwrap();

    let (final_snapshot_sender, final_snapshot_receiver) = mpsc::channel();
    let server_token = discovery.token.clone();
    let server = thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::UnixListener::from_std(listener).unwrap();
            let mut guard = RequestGuard::new(server_token);
            for _ in 0..10 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let request = ipc::read_frame::<RequestEnvelope>(&mut stream).await.unwrap();
                guard.validate(&request).unwrap();
                let request_id = request.request_id;
                let result: Result<AppResponse, ProtocolError> = ipc::dispatch(&mut service, request.request);
                ipc::write_frame(&mut stream, &ResponseEnvelope { request_id, result })
                    .await
                    .unwrap();
            }
            let status = service.status(&session_id).unwrap();
            service.save(&session_id, &status.snapshot.heads).unwrap();
            let final_snapshot = service.status(&session_id).unwrap().snapshot;
            service.close(&session_id).unwrap();
            final_snapshot_sender.send(final_snapshot).unwrap();
        });
    });

    let committed_shape = run([
        "shape",
        "create",
        "--app",
        "--session-id",
        "session:1",
        "--kind",
        "rect",
        "--layer",
        layer_id.as_str(),
        "--role",
        "architecture.service",
        "--json",
    ]);
    assert_success(&committed_shape);
    let committed_shape_json = parse_stdout(&committed_shape);
    assert_eq!(committed_shape_json["status"]["dirty"], true);
    assert_eq!(
        committed_shape_json["commit"]["patch"]["created"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let context = run(["app", "context", "--session-id", "session:1", "--json"]);
    assert_success(&context);
    let context_json = parse_stdout(&context);
    assert_eq!(context_json["page_id"], page_id.as_str());
    assert_eq!(context_json["active_layer_id"], layer_id.as_str());
    assert_eq!(context_json["viewport"]["width"], 100.0);

    let rendered = run([
        "app",
        "render",
        "--session-id",
        "session:1",
        "--output",
        path(&live_svg_path),
        "--json",
    ]);
    assert_success(&rendered);
    assert!(fs::read_to_string(&live_svg_path).unwrap().starts_with("<svg"));

    let controlled = run([
        "app",
        "ui",
        "--session-id",
        "session:1",
        "--page",
        page_id.as_str(),
        "--layer",
        layer_id.as_str(),
        "--clear-selection",
        "--camera",
        "10,20,1.5",
        "--json",
    ]);
    assert_success(&controlled);
    assert_eq!(parse_stdout(&controlled)["controlled"], true);

    let accepted = run(["app", "inspect", "--session-id", "session:1", "--json"]);
    assert_success(&accepted);

    let second_shape = run([
        "shape",
        "create",
        "--app",
        "--session-id",
        "session:1",
        "--kind",
        "ellipse",
        "--layer",
        layer_id.as_str(),
        "--role",
        "architecture.database",
        "--json",
    ]);
    assert_success(&second_shape);
    assert_eq!(parse_stdout(&second_shape)["status"]["dirty"], true);

    let direct_state = run(["app", "inspect", "--session-id", "session:1", "--json"]);
    assert_success(&direct_state);
    let direct_heads = parse_stdout(&direct_state)["heads"].clone();
    let direct_transaction = TransactionDraft {
        id: TransactionId("transaction:authorized".into()),
        actor_id: actor,
        origin: Origin::Agent,
        base_heads: serde_json::from_value(direct_heads).unwrap(),
        description: "authorized direct edit".into(),
        operations: vec![Operation::RenamePage { page_id, name: "Applied".into(), expected_version: None }],
        timestamp: Timestamp(11),
    };
    fs::write(
        &transaction_path,
        serde_json::to_vec_pretty(&direct_transaction).unwrap(),
    )
    .unwrap();

    let applied = run([
        "app",
        "apply",
        "--session-id",
        "session:1",
        "--transaction",
        path(&transaction_path),
        "--json",
    ]);
    assert_success(&applied);
    assert_eq!(parse_stdout(&applied)["status"]["dirty"], true);

    server.join().unwrap();
    let final_snapshot = final_snapshot_receiver.recv().unwrap();
    assert_eq!(final_snapshot.document.pages.values().next().unwrap().name, "Applied");
    assert!(
        final_snapshot
            .document
            .shapes
            .contains_key(&ShapeId::from("shape:rect:1"))
    );
    assert!(
        final_snapshot
            .document
            .shapes
            .contains_key(&ShapeId::from("shape:ellipse:1"))
    );
    let mut reopened = DocumentFile::open(&document_path, ActorId::from("actor:verify")).unwrap();
    assert_eq!(
        reopened
            .snapshot()
            .unwrap()
            .document
            .pages
            .values()
            .next()
            .unwrap()
            .name,
        "Applied"
    );

    let _ = ipc::remove_discovery(&ipc::discovery_path(), &discovery);
    let _ = fs::remove_file(endpoint_path);
    if let Some(previous) = previous_discovery {
        ipc::write_discovery(&ipc::discovery_path(), &previous).unwrap();
    }
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

fn parse_stderr(output: &Output) -> Value {
    serde_json::from_slice(&output.stderr).unwrap()
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
