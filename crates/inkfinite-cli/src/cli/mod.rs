//! File-mode command-line interface for Inkfinite documents.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Error, anyhow};
use clap::{ArgGroup, Args, Parser, Subcommand, ValueEnum};
use inkfinite_core::engine::{EngineError, validate_document};
use inkfinite_core::file::{DocumentFile, FileError};
use inkfinite_core::proto::{
    Bounds, LayoutAxis, Operation, PROTOCOL_ID, PROTOCOL_VERSION, Query, RecordId, ShapeAlignment, ShapePatch,
    TransactionDraft, TransactionId,
};
use inkfinite_core::render::{SvgRenderOptions, render_svg};
use inkfinite_core::{
    ActorId, BindingAnchor, BindingId, BindingKind, BindingRecord, DocumentId, INKFINITE_FORMAT_ID,
    INKFINITE_FORMAT_VERSION, LayerId, Opacity, Origin, PageId, Provenance, RecordVersion, SemanticMetadata, ShapeId,
    ShapeKind, ShapeParent, ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform, Vec2, blank_document,
    builtin_shape_kinds,
};
use serde::Serialize;
use serde_json::{Value, json};

const ACTOR_ID: &str = "actor:inkfinite-cli";
const EXIT_INPUT: i32 = 3;
const EXIT_INVALID: i32 = 4;
const EXIT_CONFLICT: i32 = 5;

const DOCUMENT_SCHEMA: &str = include_str!("../../../../schemas/document-snapshot.schema.json");
const TRANSACTION_SCHEMA: &str = include_str!("../../../../schemas/transaction-draft.schema.json");
const PROTOCOL_REQUEST_SCHEMA: &str = include_str!("../../../../schemas/protocol-request.schema.json");
const PROTOCOL_RESPONSE_SCHEMA: &str = include_str!("../../../../schemas/protocol-response.schema.json");
const PROTOCOL_ERROR_SCHEMA: &str = include_str!("../../../../schemas/protocol-error.schema.json");

pub type Result<T> = std::result::Result<T, CliError>;

#[derive(Debug)]
pub struct CliError {
    exit_code: i32,
    pub source: Error,
}

impl CliError {
    fn new(exit_code: i32, source: impl Into<Error>) -> Self {
        Self { exit_code, source: source.into() }
    }

    fn context(self, message: impl std::fmt::Display + Send + Sync + 'static) -> Self {
        Self { exit_code: self.exit_code, source: self.source.context(message) }
    }

    pub fn exit_code(&self) -> i32 {
        self.exit_code
    }
}

mod app;
mod apply;
mod args;
mod connect;
mod contract;
mod document;
mod layout;
mod mutation;
mod render;
mod shape;
mod support;

use args::{
    AlignmentArg, ApplyArgs, AxisArg, ConnectArgs, FileOutputArgs, LayoutCommand, LayoutSelectionArgs, NewArgs,
    QueryArgs, RenderArgs, SchemaKind, ShapeCommand, ShapeCreateArgs, ShapeDeleteArgs, ShapePatchArgs,
};
use support::parse_bounds;

pub use args::{Cli, Command};

pub fn run(command: Command, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    match command {
        Command::New(args) => document::create_document(args, json_output, stdout),
        Command::Inspect(args) => document::inspect_document(&args, json_output, stdout),
        Command::Query(args) => document::query_document(args, json_output, stdout),
        Command::App(command) => app::run_app_command(command, json_output, stdout),
        Command::Validate(args) => document::validate_file(&args, json_output, stdout),
        Command::Apply(args) => apply::apply_transaction(&args, json_output, stdout),
        Command::Shape(command) => shape::run_shape_command(command, json_output, stdout),
        Command::Connect(args) => connect::connect_shapes(args, json_output, stdout),
        Command::Layout(command) => layout::run_layout_command(command, json_output, stdout),
        Command::Render(args) => render::render_document(args, json_output, stdout),
        Command::Schema(args) => contract::print_schema(args.kind, stdout),
        Command::Capabilities => contract::print_capabilities(json_output, stdout),
    }
}
