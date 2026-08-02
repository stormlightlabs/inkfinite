use super::mutation::{StructuredMutationTarget, read_json_argument, select_unique_shape};
use super::{
    BTreeMap, BuiltinShapeKind, CliError, EXIT_INVALID, LayerId, Opacity, Operation, Origin, Provenance, RecordVersion,
    Result, SemanticMetadata, Serialize, ShapeCommand, ShapeCreateArgs, ShapeDeleteArgs, ShapeDescribeArgs, ShapeId,
    ShapeKind, ShapeParent, ShapePatch, ShapePatchArgs, ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform,
    Value, Vec2, Write, anyhow, builtin_shape_kinds,
};

#[derive(Serialize)]
struct ShapeKindDescription {
    kind: &'static str,
    allows_children: bool,
    common_properties: [ShapePropertyDescription; 2],
}

#[derive(Clone, Copy, Serialize)]
struct ShapePropertyDescription {
    name: &'static str,
    value_type: &'static str,
    required: bool,
    finite: bool,
    minimum: f64,
    default: f64,
}

pub fn run_shape_command(command: ShapeCommand, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    match command {
        ShapeCommand::Create(args) => create_shape(args, json_output, stdout),
        ShapeCommand::Patch(args) => patch_shape(&args, json_output, stdout),
        ShapeCommand::Delete(args) => delete_shape(&args, json_output, stdout),
        ShapeCommand::Kinds => list_shape_kinds(json_output, stdout),
        ShapeCommand::Describe(args) => describe_shape_kind(&args, json_output, stdout),
    }
}

fn list_shape_kinds(json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let descriptions: Vec<ShapeKindDescription> =
        BuiltinShapeKind::ALL.into_iter().map(shape_kind_description).collect();
    if json_output {
        return super::support::write_json(stdout, &descriptions);
    }
    for description in descriptions {
        writeln!(
            stdout,
            "{}\tchildren={}\tproperties=width,height",
            description.kind, description.allows_children
        )
        .map_err(super::support::map_output_error)?;
    }
    Ok(())
}

fn describe_shape_kind(args: &ShapeDescribeArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let kind = BuiltinShapeKind::parse(&args.kind).ok_or_else(|| {
        CliError::new(
            EXIT_INVALID,
            anyhow!(
                "unknown shape kind {}; expected one of {}",
                args.kind,
                builtin_shape_kinds().join(", ")
            ),
        )
    })?;
    let description = shape_kind_description(kind);
    if json_output {
        super::support::write_json(stdout, &description)
    } else {
        writeln!(stdout, "Kind: {}", description.kind).map_err(super::support::map_output_error)?;
        writeln!(stdout, "Allows children: {}", description.allows_children)
            .map_err(super::support::map_output_error)?;
        writeln!(
            stdout,
            "Properties: width, height (finite numbers, minimum 0, default 0)"
        )
        .map_err(super::support::map_output_error)
    }
}

fn shape_kind_description(kind: BuiltinShapeKind) -> ShapeKindDescription {
    const DIMENSION: ShapePropertyDescription = ShapePropertyDescription {
        name: "width",
        value_type: "number",
        required: false,
        finite: true,
        minimum: 0.0,
        default: 0.0,
    };
    ShapeKindDescription {
        kind: kind.as_str(),
        allows_children: kind == BuiltinShapeKind::Container,
        common_properties: [DIMENSION, ShapePropertyDescription { name: "height", ..DIMENSION }],
    }
}

fn create_shape(args: ShapeCreateArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    if !args.x.is_finite() || !args.y.is_finite() || !args.rotation.is_finite() {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!("shape transform values must be finite"),
        ));
    }
    if !builtin_shape_kinds().contains(&args.kind.as_str()) {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!(
                "unknown shape kind {}; expected one of {}",
                args.kind,
                builtin_shape_kinds().join(", ")
            ),
        ));
    }
    let properties: BTreeMap<String, Value> = serde_json::from_str(&args.properties)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not parse --properties JSON object"))?;
    let parent = match (args.layer, args.parent_shape) {
        (Some(layer), None) => ShapeParent::Layer(LayerId::from(layer)),
        (None, Some(shape)) => ShapeParent::Shape(ShapeId::from(shape)),
        _ => return Err(CliError::new(EXIT_INVALID, anyhow!("select exactly one shape parent"))),
    };
    let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
    let provenance_actor = match &target {
        StructuredMutationTarget::File(file) => file.actor_id().clone(),
        StructuredMutationTarget::App { status, .. } => status.actor_id.clone(),
    };
    let shape_id = match args.shape_id {
        Some(shape_id) => ShapeId::from(shape_id),
        None => {
            let snapshot = target.snapshot()?;
            let mut suffix = 1_u64;
            loop {
                let candidate = ShapeId::from(format!("shape:{}:{suffix}", args.kind));
                if !snapshot.document.shapes.contains_key(&candidate) {
                    break candidate;
                }
                suffix = suffix.saturating_add(1);
            }
        }
    };
    let shape = ShapeRecord {
        id: shape_id.clone(),
        kind: ShapeKind::from(args.kind),
        parent,
        transform: Transform {
            translation: Vec2 { x: args.x, y: args.y },
            rotation: args.rotation,
            scale_x: 1.0,
            scale_y: 1.0,
        },
        child_ids: Vec::new(),
        layout: None,
        properties,
        metadata: SemanticMetadata {
            name: args.name,
            role: args.role,
            description: None,
            tags: args.tags,
            locked: args.locked,
            agent_editable: args.agent_editable,
            provenance: Provenance {
                actor_id: provenance_actor,
                origin: Origin::Agent,
                timestamp: Timestamp(0),
                source: None,
            },
        },
        style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
        version: RecordVersion(1),
    };
    let transaction = target.transaction(
        args.mutation.transaction_id.clone(),
        format!("shape:create:{}", shape_id.as_str()),
        format!("create shape {shape_id}"),
        vec![Operation::CreateShape { shape, anchor: SiblingAnchor::Last }],
    )?;
    target.finish(transaction, &args.mutation, json_output, stdout)
}

fn patch_shape(args: &ShapePatchArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let patch_json = read_json_argument(&args.patch, "shape patch")?;
    let patch: ShapePatch = serde_json::from_str(&patch_json)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not parse ShapePatch JSON"))?;
    let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
    let snapshot = target.snapshot()?;
    let shape_id = select_unique_shape(
        &snapshot.document,
        args.shape_id.as_deref(),
        args.name.as_deref(),
        args.role.as_deref(),
    )?;
    let transaction = target.transaction(
        args.mutation.transaction_id.clone(),
        format!("shape:patch:{}", shape_id.as_str()),
        format!("patch shape {shape_id}"),
        vec![Operation::PatchShape { shape_id, patch, expected_version: args.expected_version.map(RecordVersion) }],
    )?;
    target.finish(transaction, &args.mutation, json_output, stdout)
}

fn delete_shape(args: &ShapeDeleteArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
    let snapshot = target.snapshot()?;
    let shape_id = select_unique_shape(
        &snapshot.document,
        args.shape_id.as_deref(),
        args.name.as_deref(),
        args.role.as_deref(),
    )?;
    let transaction = target.transaction(
        args.mutation.transaction_id.clone(),
        format!("shape:delete:{}", shape_id.as_str()),
        format!("delete shape {shape_id}"),
        vec![Operation::DeleteShape { shape_id, expected_version: args.expected_version.map(RecordVersion) }],
    )?;
    target.finish(transaction, &args.mutation, json_output, stdout)
}
