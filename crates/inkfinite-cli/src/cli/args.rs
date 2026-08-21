use super::{ArgGroup, Args, Bounds, CameraState, Parser, PathBuf, Subcommand, ValueEnum, parse_bounds};

#[derive(Debug, Parser)]
#[command(
    name = "inkfinite",
    version,
    about = "Work with Inkfinite documents from the command line",
    long_about = "Create, inspect, query, edit, validate, and render canonical Inkfinite documents, or inspect a running desktop app."
)]
#[command(after_help = "Examples:
  inkfinite new architecture.inkfinite
  inkfinite inspect architecture.inkfinite --json
  inkfinite apply architecture.inkfinite --transaction transaction.json --dry-run
  inkfinite import svg architecture.inkfinite --input icon.svg
  inkfinite render architecture.inkfinite --output architecture.svg
  inkfinite app status --json

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
    Inspect(InspectArgs),
    /// Find records using semantic, hierarchy, kind, and bounds filters.
    #[command(after_help = "Examples:

    inkfinite query architecture.inkfinite --role architecture.service --json
    inkfinite query architecture.inkfinite --kind rect --bounds 0,0,1920,1080
")]
    Query(QueryArgs),
    /// Inspect or focus a running desktop app over authenticated local IPC.
    #[command(subcommand)]
    App(AppCommand),
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
    /// Import external formats through the transaction engine.
    #[command(subcommand)]
    Import(ImportCommand),
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
    /// Render a canonical document to SVG or PNG.
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
    /// Print a shell completion script.
    #[command(
        visible_alias = "comp",
        after_help = "Examples:

    inkfinite completions bash > inkfinite.bash
    inkfinite comp zsh > _inkfinite
"
    )]
    Completions(CompletionsArgs),
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
pub struct InspectArgs {
    /// Canonical .inkfinite document to read.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,

    /// Return identity, heads, initial record IDs, and counts instead of the complete snapshot.
    #[arg(long)]
    pub summary: bool,
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
pub enum ImportCommand {
    /// Import a static SVG into a document or open desktop session.
    #[command(after_help = "Examples:

    inkfinite import svg architecture.inkfinite --input icon.svg
    inkfinite import svg architecture.inkfinite --input logo.svg --layer layer:architecture:1 --dry-run
")]
    Svg(SvgImportArgs),
}

#[derive(Debug, Args)]
pub struct SvgImportArgs {
    /// Canonical .inkfinite document to change. Omit when using --app.
    #[arg(value_name = "FILE")]
    pub path: Option<PathBuf>,
    /// SVG file to import.
    #[arg(long, value_name = "SVG_FILE")]
    pub input: PathBuf,
    /// Target page. Defaults to the active page or first page.
    #[arg(long, value_name = "PAGE_ID")]
    pub page: Option<String>,
    /// Target layer. Defaults to the active layer or first layer on the page.
    #[arg(long, value_name = "LAYER_ID")]
    pub layer: Option<String>,
    #[command(flatten)]
    pub mutation: MutationOptions,
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
    /// List built-in shape kinds and their common property contract.
    Kinds,
    /// Describe one built-in shape kind.
    Describe(ShapeDescribeArgs),
}

#[derive(Debug, Args)]
pub struct ShapeDescribeArgs {
    /// Built-in registry key to describe.
    #[arg(value_name = "KIND")]
    pub kind: String,
}

#[derive(Debug, Args)]
pub struct MutationOptions {
    /// Validate and report the result without saving the document.
    #[arg(long)]
    pub dry_run: bool,

    /// Stable transaction ID. A command-specific ID is used when omitted.
    #[arg(long, value_name = "ID")]
    pub transaction_id: Option<String>,

    /// Write the validated transaction to a new JSON file without changing the document.
    #[arg(long, value_name = "FILE")]
    pub transaction_out: Option<PathBuf>,

    /// Apply this edit to the running desktop app.
    #[arg(long)]
    pub app: bool,

    /// Target this desktop session when --app is used.
    #[arg(long, value_name = "SESSION_ID", requires = "app")]
    pub session_id: Option<String>,
}

#[derive(Debug, Args)]
#[command(group(ArgGroup::new("parent").args(["layer", "parent_shape"])))]
#[command(group(ArgGroup::new("relative_target").args(["relative_id", "relative_name", "relative_role"])))]
pub struct ShapeCreateArgs {
    /// Canonical document to change. Omit when using --app.
    #[arg(value_name = "FILE")]
    pub path: Option<PathBuf>,
    /// Stable ID for the new shape. A deterministic available ID is generated when omitted.
    #[arg(long, value_name = "ID")]
    pub shape_id: Option<String>,
    /// Built-in shape registry key.
    #[arg(long, value_name = "KIND")]
    pub kind: String,
    /// Parent layer ID.
    #[arg(long, value_name = "LAYER_ID")]
    pub layer: Option<String>,
    /// Parent container shape ID.
    #[arg(long, value_name = "SHAPE_ID")]
    pub parent_shape: Option<String>,
    /// Place relative to this exact shape ID.
    #[arg(long, value_name = "SHAPE_ID")]
    pub relative_id: Option<String>,
    /// Place relative to the uniquely named shape.
    #[arg(long)]
    pub relative_name: Option<String>,
    /// Place relative to the shape with this unique semantic role.
    #[arg(long)]
    pub relative_role: Option<String>,
    /// Spatial relationship to the selected target.
    #[arg(long, value_enum, requires = "relative_target")]
    pub placement: Option<PlacementArg>,
    /// Space between the new shape and its semantic target.
    #[arg(long, default_value_t = 24.0, allow_hyphen_values = true)]
    pub gap: f64,
    /// Horizontal position in parent coordinates.
    #[arg(long, default_value_t = 0.0, allow_hyphen_values = true)]
    pub x: f64,
    /// Vertical position in parent coordinates.
    #[arg(long, default_value_t = 0.0, allow_hyphen_values = true)]
    pub y: f64,
    /// Clockwise rotation in radians.
    #[arg(long, default_value_t = 0.0, allow_hyphen_values = true)]
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
    /// Canonical document to change. Omit when using --app.
    #[arg(value_name = "FILE")]
    pub path: Option<PathBuf>,
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
    /// Canonical document to change. Omit when using --app.
    #[arg(value_name = "FILE")]
    pub path: Option<PathBuf>,
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
    /// Canonical document to change. Omit when using --app.
    #[arg(value_name = "FILE")]
    pub path: Option<PathBuf>,
    /// Stable ID for the new binding. A deterministic available ID is generated when omitted.
    #[arg(long, value_name = "ID")]
    pub binding_id: Option<String>,
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
    /// Canonical document to change. Omit when using --app.
    #[arg(value_name = "FILE")]
    pub path: Option<PathBuf>,
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
    /// Canonical document to change. Omit when using --app.
    #[arg(value_name = "FILE")]
    pub path: Option<PathBuf>,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum PlacementArg {
    Inside,
    Below,
    RightOf,
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignTop,
    AlignMiddle,
    AlignBottom,
}

#[derive(Debug, Args)]
pub struct RenderArgs {
    /// Canonical .inkfinite document to render.
    #[arg(value_name = "FILE")]
    pub path: PathBuf,
    /// Destination .svg or .png file.
    #[arg(long, value_name = "OUTPUT_FILE")]
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
    /// Include complete matching records, including versions and semantic metadata.
    #[arg(long)]
    pub detail: bool,
    /// Return at most this many matches after deterministic sorting.
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..))]
    pub limit: Option<u32>,
}

#[derive(Debug, Subcommand)]
#[allow(clippy::large_enum_variant)]
pub enum AppCommand {
    /// List the sessions currently open in the desktop app.
    #[command(after_help = "Example:

    inkfinite app status --json
")]
    Status,
    /// Return the active page, selection, viewport, actor, and current heads.
    Context(AppInspectArgs),
    /// Print the current snapshot from the desktop app.
    #[command(after_help = "Examples:

    inkfinite app inspect --json
    inkfinite app inspect --session-id session:1 --json
")]
    Inspect(AppInspectArgs),
    /// Query the current desktop session using shared semantic filters.
    #[command(after_help = "Examples:

    inkfinite app query --role architecture.service --json
    inkfinite app query --session-id session:1 --kind rect
")]
    Query(AppQueryArgs),
    /// Render the current live document and an optional proposed result without applying it.
    Render(AppRenderArgs),
    /// Change the desktop page, active layer, selection, or camera.
    Ui(AppUiArgs),
    /// Validate and apply a transaction to the running desktop app.
    #[command(after_help = "Example:

    inkfinite app apply --transaction transaction.json --json
")]
    Apply(AppApplyArgs),
    /// Ask the desktop frontend to focus its main window.
    #[command(after_help = "Example:

    inkfinite app focus
")]
    Focus,
}

#[derive(Debug, Args)]
pub struct AppRenderArgs {
    /// Write the current live document to a .svg or .png file.
    #[arg(long, value_name = "OUTPUT_FILE")]
    pub output: PathBuf,
    /// Write the proposed result to a .svg or .png file. Requires --transaction.
    #[arg(long, value_name = "OUTPUT_FILE", requires = "transaction")]
    pub proposed_output: Option<PathBuf>,
    /// Transaction JSON file, or - for standard input, to preview without applying.
    #[arg(long, value_name = "TRANSACTION", requires = "proposed_output")]
    pub transaction: Option<PathBuf>,
    /// Render this page instead of the first page.
    #[arg(long, value_name = "PAGE_ID")]
    pub page: Option<String>,
    /// Use this exact world-space output region.
    #[arg(long, value_name = "X,Y,WIDTH,HEIGHT", value_parser = parse_bounds)]
    pub region: Option<Bounds>,
    /// Render this session, or the only open session when omitted.
    #[arg(long, value_name = "SESSION_ID")]
    pub session_id: Option<String>,
}

#[derive(Debug, Args)]
pub struct AppUiArgs {
    /// Show this page.
    #[arg(long, value_name = "PAGE_ID")]
    pub page: Option<String>,
    /// Activate this layer.
    #[arg(long, value_name = "LAYER_ID")]
    pub layer: Option<String>,
    /// Replace the selection with this shape. May be repeated; pass no --select to preserve it.
    #[arg(long = "select", value_name = "SHAPE_ID")]
    pub selection: Vec<String>,
    /// Clear the current selection.
    #[arg(long, conflicts_with = "selection")]
    pub clear_selection: bool,
    /// Set camera center and zoom as x,y,zoom.
    #[arg(long, value_name = "X,Y,ZOOM", value_parser = parse_camera)]
    pub camera: Option<CameraState>,
    /// Control this session, or the only open session when omitted.
    #[arg(long, value_name = "SESSION_ID")]
    pub session_id: Option<String>,
}

fn parse_camera(value: &str) -> std::result::Result<CameraState, String> {
    let values = value
        .split(',')
        .map(str::trim)
        .map(str::parse::<f64>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| format!("invalid camera: {error}"))?;
    let [x, y, zoom] = values.as_slice() else {
        return Err("camera must contain x,y,zoom".into());
    };
    if !x.is_finite() || !y.is_finite() || !zoom.is_finite() || *zoom <= 0.0 {
        return Err("camera coordinates must be finite and zoom must be positive".into());
    }
    Ok(CameraState { x: *x, y: *y, zoom: *zoom })
}

#[derive(Debug, Args)]
pub struct AppInspectArgs {
    /// Inspect this session, or the only open session when omitted.
    #[arg(long, value_name = "SESSION_ID")]
    pub session_id: Option<String>,
}

#[derive(Debug, Args)]
pub struct AppQueryArgs {
    /// Query this session, or the only open session when omitted.
    #[arg(long, value_name = "SESSION_ID")]
    pub session_id: Option<String>,
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
    /// Include complete matching records, including versions and semantic metadata.
    #[arg(long)]
    pub detail: bool,
    /// Return at most this many matches after deterministic sorting.
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..))]
    pub limit: Option<u32>,
}

#[derive(Debug, Args)]
pub struct AppApplyArgs {
    /// Transaction JSON file, or - to read standard input.
    #[arg(long, value_name = "TRANSACTION")]
    pub transaction: PathBuf,
    /// Apply in this session, or the only open session when omitted.
    #[arg(long, value_name = "SESSION_ID")]
    pub session_id: Option<String>,
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

#[derive(Debug, Args)]
pub struct CompletionsArgs {
    /// Shell to generate completions for.
    #[arg(value_enum, value_name = "SHELL")]
    pub shell: CompletionShell,
}

/// Shells supported by the completion command and source distribution.
#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum CompletionShell {
    /// Bourne Again Shell.
    Bash,
    /// Friendly Interactive Shell.
    Fish,
    /// Z Shell.
    Zsh,
}
