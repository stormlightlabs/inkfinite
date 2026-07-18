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
use inkfinite_core::{
    ActorId, DocumentId, Opacity, Origin, Provenance, RecordVersion, SemanticMetadata, ShapeId, ShapeKind, ShapeParent,
    ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform, Vec2, blank_document,
};
use serde_json::Value;

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
fn structured_create_can_be_validated_reopened_and_rendered() {
    let temporary = TestDirectory::new("render");
    let document_path = temporary.path.join("render.inkfinite");
    let svg_path = temporary.path.join("render.svg");
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
                    }),
                    AppRequest::Focus => AppResponse::Focused,
                    AppRequest::Propose { .. }
                    | AppRequest::AcceptProposal { .. }
                    | AppRequest::RejectProposal { .. }
                    | AppRequest::Apply { .. } => panic!("proposal requests are outside this IPC fixture"),
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
fn live_propose_accept_partial_and_authorized_apply_round_trip_through_cli() {
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
    let document_id = DocumentId::from("document:live-proposals");
    let actor = ActorId::from("actor:live-proposals");
    let document = blank_document(&document_id, Some("Live proposals"));
    let mut file = DocumentFile::create(&document_path, document_id, actor.clone(), document).unwrap();
    let snapshot = file.snapshot().unwrap();
    drop(file);

    let page_id = snapshot.document.page_ids[0].clone();
    let proposal_transaction = TransactionDraft {
        id: TransactionId("transaction:proposal".into()),
        actor_id: actor.clone(),
        origin: Origin::Agent,
        base_heads: snapshot.heads.clone(),
        description: "preview a page rename".into(),
        operations: vec![Operation::RenamePage {
            page_id: page_id.clone(),
            name: "Proposed".into(),
            expected_version: None,
        }],
        timestamp: Timestamp(10),
    };
    fs::write(
        &transaction_path,
        serde_json::to_vec_pretty(&proposal_transaction).unwrap(),
    )
    .unwrap();

    let mut service = SessionService::new();
    let opened = service.open(&document_path, actor.clone()).unwrap();
    let session_id = opened.session_id.clone();
    let authorization = service.authorize_apply(&session_id).unwrap();
    let authorization_token = authorization.token.clone();

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
            for _ in 0..3 {
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

    let proposed = run([
        "app",
        "propose",
        "--session-id",
        "session:1",
        "--transaction",
        path(&transaction_path),
        "--json",
    ]);
    assert_success(&proposed);
    let proposed_json = parse_stdout(&proposed);
    assert_eq!(proposed_json["id"], "proposal:1");
    assert_eq!(proposed_json["preview"]["changed"].as_array().unwrap().len(), 1);

    let accepted = run([
        "app",
        "accept",
        "--session-id",
        "session:1",
        "--proposal-id",
        "proposal:1",
        "--json",
    ]);
    assert_success(&accepted);
    let accepted_json = parse_stdout(&accepted);
    let accepted_heads = accepted_json["status"]["snapshot"]["heads"].clone();
    let direct_transaction = TransactionDraft {
        id: TransactionId("transaction:authorized".into()),
        actor_id: actor,
        origin: Origin::Agent,
        base_heads: serde_json::from_value(accepted_heads).unwrap(),
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
        "--authorization",
        &authorization_token,
        "--json",
    ]);
    assert_success(&applied);
    assert_eq!(parse_stdout(&applied)["status"]["dirty"], true);

    server.join().unwrap();
    let final_snapshot = final_snapshot_receiver.recv().unwrap();
    assert_eq!(final_snapshot.document.pages.values().next().unwrap().name, "Applied");
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
