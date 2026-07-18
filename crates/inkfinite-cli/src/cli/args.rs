use super::{ArgGroup, Args, Bounds, Parser, PathBuf, Subcommand, ValueEnum, parse_bounds};

#[derive(Debug, Parser)]
#[command(
    name = "inkfinite",
    version,
    about = "Work with Inkfinite documents from the command line",
    long_about = "Create, inspect, query, edit, validate, and render canonical Inkfinite documents while the desktop app is closed."
)]
#[command(after_help = "Examples:
  inkfinite new architecture.inkfinite
  inkfinite inspect architecture.inkfinite --json
  inkfinite apply architecture.inkfinite --transaction transaction.json --dry-run
  inkfinite render architecture.inkfinite --output architecture.svg

Documentation: https://github.com/stormlightlabs/inkfinite#file-mode-cli
Report issues: https://github.com/stormlightlabs/inkfinite/issues

Exit codes:

0  Success
2  Invalid command usage
3  File or input error
4  Invalid document or data
5  Existing file, lock, or state conflict
")]
pub struct Cli {
    /// Disable interactive behavior. File-mode commands never prompt.
    #[arg(long, global = true, help_heading = "Global options")]
    pub non_interactive: bool,

    /// Write deterministic machine-readable JSON to stdout where supported.
    #[arg(long, global = true, help_heading = "Global options")]
    pub json: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Create a blank canonical document.
    #[command(after_help = "Examples:

    inkfinite new architecture.inkfinite
    inkfinite new system-map.inkfinite --document-id document:system-map --page-name Architecture
")]
    New(NewArgs),
    /// Print a materialized document snapshot or summary.
    #[command(after_help = "Examples:

    inkfinite inspect architecture.inkfinite
    inkfinite inspect architecture.inkfinite --json
")]
    Inspect(FileOutputArgs),
    /// Find records using semantic, hierarchy, kind, and bounds filters.
    #[command(after_help = "Examples:

    inkfinite query architecture.inkfinite --role architecture.service --json
    inkfinite query architecture.inkfinite --kind rect --bounds 0,0,1920,1080
")]
    Query(QueryArgs),
    /// Load and validate a canonical document.
    #[command(after_help = "Examples:

    inkfinite validate architecture.inkfinite
    inkfinite validate architecture.inkfinite --json
")]
    Validate(FileOutputArgs),
    /// Apply a transaction read from a JSON file or standard input.
    #[command(after_help = "Examples:

    inkfinite apply architecture.inkfinite --transaction transaction.json --dry-run
    cat transaction.json | inkfinite apply architecture.inkfinite --transaction - --json
")]
    Apply(ApplyArgs),
    /// Create, patch, or delete a shape through the transaction engine.
    #[command(subcommand)]
    Shape(ShapeCommand),
    /// Create a binding between two shapes.
    #[command(after_help = "Example:

    inkfinite connect architecture.inkfinite --binding-id binding:api-db --source shape:arrow --target-role architecture.database
")]
    Connect(ConnectArgs),
    /// Align or distribute shapes through the transaction engine.
    #[command(subcommand)]
    Layout(LayoutCommand),
    /// Render a canonical document to deterministic SVG.
    #[command(after_help = "Examples:

    inkfinite render architecture.inkfinite --output architecture.svg
    inkfinite render architecture.inkfinite --output services.svg --role architecture.service
")]
    Render(RenderArgs),
    /// Print a checked-in generated JSON Schema.
    #[command(after_help = "Examples:

    inkfinite schema document
    inkfinite schema protocol
")]
    Schema(SchemaArgs),
    /// Report the stable file-mode command contract.
    #[command(after_help = "Examples:

    inkfinite capabilities
    inkfinite capabilities --json
")]
    Capabilities,
}

#[derive(Debug, Args)]
pub struct NewArgs {
    /// Destination for the new canonical document.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,

    /// Stable document ID. Defaults to one derived from the filename.
    #[arg(long, value_name = "ID")]
    pub document_id: Option<String>,

    /// Name of the initial page.
    #[arg(long, value_name = "NAME")]
    pub page_name: Option<String>,
}

#[derive(Debug, Args)]
pub struct FileOutputArgs {
    /// Canonical .inkfinite document to read.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,
}

#[derive(Debug, Args)]
pub struct ApplyArgs {
    /// Canonical .inkfinite document to change.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,

    /// Transaction JSON file, or - to read standard input.
    #[arg(long, value_name = "TRANSACTION")]
    pub transaction: PathBuf,

    /// Validate and report the result without saving the document.
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Debug, Subcommand)]
pub enum ShapeCommand {
    /// Create a shape in a layer or container.
    #[command(after_help = "Example:

    inkfinite shape create architecture.inkfinite --shape-id shape:api --kind rect --layer layer:architecture:1 --x 80 --y 120 --properties '{\"width\":240,\"height\":120}' --role architecture.service
")]
    Create(ShapeCreateArgs),
    /// Patch a uniquely selected shape from a JSON `ShapePatch`.
    #[command(after_help = "Example:

    inkfinite shape patch architecture.inkfinite --role architecture.service --patch '{\"transform\":{\"translation\":{\"x\":120,\"y\":80},\"rotation\":0,\"scale_x\":1,\"scale_y\":1}}'
")]
    Patch(ShapePatchArgs),
    /// Delete a uniquely selected shape and its descendants.
    #[command(after_help = "Example:

    inkfinite shape delete architecture.inkfinite --role architecture.deprecated --expected-version 3
")]
    Delete(ShapeDeleteArgs),
}

#[derive(Debug, Args)]
pub struct MutationOptions {
    /// Validate and report the result without saving the document.
    #[arg(long)]
    pub dry_run: bool,

    /// Stable transaction ID. A command-specific ID is used when omitted.
    #[arg(long, value_name = "ID")]
    pub transaction_id: Option<String>,
}

#[derive(Debug, Args)]
#[command(group(ArgGroup::new("parent").required(true).args(["layer", "parent_shape"])))]
pub struct ShapeCreateArgs {
    /// Canonical .inkfinite document to change.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,
    /// Stable ID for the new shape.
    #[arg(long, value_name = "ID")]
    pub shape_id: String,
    /// Built-in shape registry key.
    #[arg(long, value_name = "KIND")]
    pub kind: String,
    /// Parent layer ID.
    #[arg(long, value_name = "LAYER_ID")]
    pub layer: Option<String>,
    /// Parent container shape ID.
    #[arg(long, value_name = "SHAPE_ID")]
    pub parent_shape: Option<String>,
    /// Horizontal position in parent coordinates.
    #[arg(long, default_value_t = 0.0)]
    pub x: f64,
    /// Vertical position in parent coordinates.
    #[arg(long, default_value_t = 0.0)]
    pub y: f64,
    /// Clockwise rotation in radians.
    #[arg(long, default_value_t = 0.0)]
    pub rotation: f64,
    /// Kind-specific properties as a JSON object.
    #[arg(long, default_value = "{}", value_name = "JSON")]
    pub properties: String,
    /// Human-readable shape name.
    #[arg(long)]
    pub name: Option<String>,
    /// Semantic role used by queries and later commands.
    #[arg(long)]
    pub role: Option<String>,
    /// Searchable semantic tag. May be repeated.
    #[arg(long = "tag")]
    pub tags: Vec<String>,
    /// Prevent direct edits to the new shape.
    #[arg(long)]
    pub locked: bool,
    /// Allow agent-originated edits to the new shape.
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    pub agent_editable: bool,
    #[command(flatten)]
    pub mutation: MutationOptions,
}

#[derive(Debug, Args)]
#[command(group(ArgGroup::new("selector").required(true).multiple(false).args(["shape_id", "name", "role"])))]
pub struct ShapePatchArgs {
    /// Canonical .inkfinite document to change.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,
    /// Select an exact shape ID.
    #[arg(long = "shape-id", value_name = "ID")]
    pub shape_id: Option<String>,
    /// Select a shape by exact display name.
    #[arg(long)]
    pub name: Option<String>,
    /// Select a shape by exact semantic role.
    #[arg(long)]
    pub role: Option<String>,
    /// `ShapePatch` JSON object, or @FILE to read it from a file.
    #[arg(long, value_name = "JSON|@FILE")]
    pub patch: String,
    /// Optimistic record version.
    #[arg(long)]
    pub expected_version: Option<u64>,
    #[command(flatten)]
    pub mutation: MutationOptions,
}

#[derive(Debug, Args)]
#[command(group(ArgGroup::new("selector").required(true).multiple(false).args(["shape_id", "name", "role"])))]
pub struct ShapeDeleteArgs {
    /// Canonical .inkfinite document to change.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,
    /// Select an exact shape ID.
    #[arg(long = "shape-id", value_name = "ID")]
    pub shape_id: Option<String>,
    /// Select a shape by exact display name.
    #[arg(long)]
    pub name: Option<String>,
    /// Select a shape by exact semantic role.
    #[arg(long)]
    pub role: Option<String>,
    /// Optimistic record version.
    #[arg(long)]
    pub expected_version: Option<u64>,
    #[command(flatten)]
    pub mutation: MutationOptions,
}

#[derive(Debug, Args)]
pub struct ConnectArgs {
    /// Canonical .inkfinite document to change.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,
    /// Stable ID for the new binding.
    #[arg(long, value_name = "ID")]
    pub binding_id: String,
    /// Exact source shape ID.
    #[arg(long, value_name = "SHAPE_ID", required_unless_present = "source_role")]
    pub source: Option<String>,
    /// Select the unique source shape by semantic role.
    #[arg(long, conflicts_with = "source")]
    pub source_role: Option<String>,
    /// Exact target shape ID.
    #[arg(long, value_name = "SHAPE_ID", required_unless_present = "target_role")]
    pub target: Option<String>,
    /// Select the unique target shape by semantic role.
    #[arg(long, conflicts_with = "target")]
    pub target_role: Option<String>,
    /// Binding registry key.
    #[arg(long, default_value = "arrow")]
    pub kind: String,
    /// Named handle on the source shape.
    #[arg(long, default_value = "end")]
    pub source_handle: String,
    /// Normalized target anchor x coordinate. Requires --anchor-y.
    #[arg(long, requires = "anchor_y")]
    pub anchor_x: Option<f64>,
    /// Normalized target anchor y coordinate. Requires --anchor-x.
    #[arg(long, requires = "anchor_x")]
    pub anchor_y: Option<f64>,
    #[command(flatten)]
    pub mutation: MutationOptions,
}

#[derive(Debug, Subcommand)]
pub enum LayoutCommand {
    /// Align two or more selected shapes.
    Align(LayoutAlignArgs),
    /// Distribute three or more selected shapes with equal gaps.
    Distribute(LayoutDistributeArgs),
}

#[derive(Debug, Args)]
pub struct LayoutSelectionArgs {
    /// Select an exact shape ID. May be repeated.
    #[arg(long = "shape", value_name = "SHAPE_ID")]
    pub shape_ids: Vec<String>,
    /// Include every shape with this exact semantic role.
    #[arg(long)]
    pub role: Option<String>,
}

#[derive(Debug, Args)]
pub struct LayoutAlignArgs {
    /// Canonical .inkfinite document to change.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,
    /// Alignment line.
    #[arg(long, value_enum)]
    pub alignment: AlignmentArg,
    #[command(flatten)]
    pub selection: LayoutSelectionArgs,
    #[command(flatten)]
    pub mutation: MutationOptions,
}

#[derive(Debug, Args)]
pub struct LayoutDistributeArgs {
    /// Canonical .inkfinite document to change.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,
    /// Distribution axis.
    #[arg(long, value_enum)]
    pub axis: AxisArg,
    #[command(flatten)]
    pub selection: LayoutSelectionArgs,
    #[command(flatten)]
    pub mutation: MutationOptions,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum AlignmentArg {
    Left,
    Center,
    Right,
    Top,
    Middle,
    Bottom,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum AxisArg {
    Horizontal,
    Vertical,
}

#[derive(Debug, Args)]
pub struct RenderArgs {
    /// Canonical .inkfinite document to render.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,
    /// Destination SVG file.
    #[arg(long, value_name = "SVG_FILE")]
    pub output: PathBuf,
    /// Render one page instead of the first page.
    #[arg(long, value_name = "PAGE_ID")]
    pub page: Option<String>,
    /// Include one layer. May be repeated.
    #[arg(long = "layer", value_name = "LAYER_ID")]
    pub layers: Vec<String>,
    /// Include one shape and its descendants. May be repeated.
    #[arg(long = "shape", value_name = "SHAPE_ID")]
    pub shapes: Vec<String>,
    /// Include every shape with this semantic role.
    #[arg(long)]
    pub role: Option<String>,
    /// Exact view box formatted as x,y,width,height.
    #[arg(long, value_name = "X,Y,WIDTH,HEIGHT", value_parser = parse_bounds)]
    pub region: Option<Bounds>,
}

#[derive(Debug, Args)]
pub struct QueryArgs {
    /// Canonical .inkfinite document to query.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,

    /// Match an exact record ID.
    #[arg(long)]
    pub id: Option<String>,
    /// Match an exact display name.
    #[arg(long)]
    pub name: Option<String>,
    /// Match an exact semantic role.
    #[arg(long)]
    pub role: Option<String>,
    /// Match one exact semantic tag.
    #[arg(long)]
    pub tag: Option<String>,
    /// Match an exact shape registry key.
    #[arg(long = "kind")]
    pub shape_kind: Option<String>,
    /// Restrict results to a page.
    #[arg(long)]
    pub page: Option<String>,
    /// Restrict results to a layer.
    #[arg(long)]
    pub layer: Option<String>,
    /// Restrict shapes to one direct parent.
    #[arg(long)]
    pub parent: Option<String>,
    /// Restrict shapes to bounds formatted as x,y,width,height.
    #[arg(long, value_name = "X,Y,WIDTH,HEIGHT", value_parser = parse_bounds)]
    pub bounds: Option<Bounds>,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum SchemaKind {
    Document,
    Transaction,
    Protocol,
    ProtocolRequest,
    ProtocolResponse,
    ProtocolError,
}

#[derive(Debug, Args)]
pub struct SchemaArgs {
    /// Contract to print.
    #[arg(value_enum, value_name = "KIND")]
    pub kind: SchemaKind,
}
