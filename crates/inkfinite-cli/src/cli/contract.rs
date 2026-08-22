use super::support::{map_json_error, map_output_error, write_json};
use super::{CliError, SchemaKind, Value, Write};
use super::{
    DOCUMENT_SCHEMA, EXIT_CONFLICT, EXIT_INPUT, EXIT_INVALID, INKFINITE_FORMAT_ID, INKFINITE_FORMAT_VERSION,
    PROTOCOL_ERROR_SCHEMA, PROTOCOL_ID, PROTOCOL_REQUEST_SCHEMA, PROTOCOL_RESPONSE_SCHEMA, PROTOCOL_VERSION,
    TRANSACTION_SCHEMA,
};
use super::{builtin_shape_kinds, json};

pub fn print_schema(kind: SchemaKind, stdout: &mut dyn Write) -> Result<(), CliError> {
    match kind {
        SchemaKind::Document => stdout.write_all(DOCUMENT_SCHEMA.as_bytes()).map_err(map_output_error),
        SchemaKind::Transaction => stdout
            .write_all(TRANSACTION_SCHEMA.as_bytes())
            .map_err(map_output_error),
        SchemaKind::ProtocolRequest => stdout
            .write_all(PROTOCOL_REQUEST_SCHEMA.as_bytes())
            .map_err(map_output_error),
        SchemaKind::ProtocolResponse => stdout
            .write_all(PROTOCOL_RESPONSE_SCHEMA.as_bytes())
            .map_err(map_output_error),
        SchemaKind::ProtocolError => stdout
            .write_all(PROTOCOL_ERROR_SCHEMA.as_bytes())
            .map_err(map_output_error),
        SchemaKind::Protocol => {
            let request: Value = serde_json::from_str(PROTOCOL_REQUEST_SCHEMA).map_err(map_json_error)?;
            let response: Value = serde_json::from_str(PROTOCOL_RESPONSE_SCHEMA).map_err(map_json_error)?;
            let error: Value = serde_json::from_str(PROTOCOL_ERROR_SCHEMA).map_err(map_json_error)?;
            write_json(
                stdout,
                &json!({ "error": error, "request": request, "response": response }),
            )
        }
    }
}

pub fn print_capabilities(json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    let capabilities = json!({
        "commands": ["new", "inspect", "query", "app", "validate", "apply", "import", "shape", "connect", "layout", "render", "schema", "completions", "capabilities"],
        "exit_codes": {
            "conflict": EXIT_CONFLICT,
            "input": EXIT_INPUT,
            "invalid": EXIT_INVALID,
            "success": 0,
            "usage": 2
        },
        "file_mode": true,
        "format": { "id": INKFINITE_FORMAT_ID, "version": INKFINITE_FORMAT_VERSION },
        "global_options": ["--json", "--non-interactive"],
        "json_stdout_is_machine_only": true,
        "json_errors": {
            "fields": ["code", "message", "details", "retryable", "suggestion"],
            "stderr_only": true
        },
        "live_mode": {
            "commands": ["status", "context", "inspect", "query", "focus", "render", "ui", "apply"],
            "transport": "authenticated_local_socket",
            "tcp_or_http": false
        },
        "mutation_commands": {
            "apply": ["--transaction", "--dry-run"],
            "import svg": ["--input", "--page", "--layer", "--dry-run", "--transaction-out", "--app"],
            "connect": ["--binding-id", "--source", "--source-role", "--target", "--target-role", "--kind", "--relation-type", "--dry-run", "--transaction-out", "--app"],
            "layout": ["align", "distribute", "stack", "grid", "tidy"],
            "shape": ["create", "patch", "delete", "kinds", "describe"],
            "semantic_placement": ["inside", "below", "right-of", "align-left", "align-center", "align-right", "align-top", "align-middle", "align-bottom"],
            "structured_targets": ["file", "app"]
        },
        "path_format": "forward_slashes",
        "protocol": { "id": PROTOCOL_ID, "version": PROTOCOL_VERSION },
        "query_filters": ["id", "name", "role", "tag", "relation-type", "incoming-to", "outgoing-from", "kind", "page", "layer", "parent", "bounds"],
        "query_options": ["detail", "limit"],
        "render_filters": ["page", "layer", "shape", "role", "region"],
        "schemas": ["document", "transaction", "protocol", "protocol-request", "protocol-response", "protocol-error"],
        "completions": { "shells": ["bash", "fish", "zsh"], "alias": "comp" },
        "shape_kinds": builtin_shape_kinds()
    });
    if json_output {
        return write_json(stdout, &capabilities);
    }

    writeln!(stdout, "File mode: supported").map_err(map_output_error)?;
    writeln!(
        stdout,
        "Document format: {INKFINITE_FORMAT_ID} {INKFINITE_FORMAT_VERSION}"
    )
    .map_err(map_output_error)?;
    writeln!(
        stdout,
        "Commands: new, inspect, query, app, validate, apply, import, shape, connect, layout, render, schema, completions, capabilities"
    )
    .map_err(map_output_error)?;
    writeln!(
        stdout,
        "Live mode: app status, app context, app inspect, app query, app focus, app render, app ui, app apply"
    )
    .map_err(map_output_error)?;
    writeln!(stdout, "Global options: --json, --non-interactive").map_err(map_output_error)?;
    writeln!(stdout, "Schemas: document, transaction, protocol").map_err(map_output_error)?;
    writeln!(stdout, "JSON: machine data on stdout; diagnostics on stderr").map_err(map_output_error)
}
