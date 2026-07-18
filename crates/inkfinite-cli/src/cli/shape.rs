use super::mutation::{commit_mutation, read_json_argument, select_unique_shape, structured_transaction};
use super::support::open_document;
use super::{
    ACTOR_ID, ActorId, BTreeMap, CliError, EXIT_INVALID, LayerId, Opacity, Operation, Origin, Provenance,
    RecordVersion, Result, SemanticMetadata, ShapeCommand, ShapeCreateArgs, ShapeDeleteArgs, ShapeId, ShapeKind,
    ShapeParent, ShapePatch, ShapePatchArgs, ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform, Value, Vec2,
    Write, anyhow, builtin_shape_kinds,
};

pub fn run_shape_command(command: ShapeCommand, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    match command {
        ShapeCommand::Create(args) => create_shape(args, json_output, stdout),
        ShapeCommand::Patch(args) => patch_shape(args, json_output, stdout),
        ShapeCommand::Delete(args) => delete_shape(args, json_output, stdout),
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
    let shape_id = ShapeId::from(args.shape_id);
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
                actor_id: ActorId::from(ACTOR_ID),
                origin: Origin::Agent,
                timestamp: Timestamp(0),
                source: None,
            },
        },
        style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
        version: RecordVersion(1),
    };
    let mut file = open_document(&args.path)?;
    let transaction = structured_transaction(
        &mut file,
        args.mutation.transaction_id,
        format!("shape:create:{}", shape_id.as_str()),
        format!("create shape {shape_id}"),
        vec![Operation::CreateShape { shape, anchor: SiblingAnchor::Last }],
    )?;
    commit_mutation(&mut file, transaction, args.mutation.dry_run, json_output, stdout)
}

fn patch_shape(args: ShapePatchArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let patch_json = read_json_argument(&args.patch, "shape patch")?;
    let patch: ShapePatch = serde_json::from_str(&patch_json)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not parse ShapePatch JSON"))?;
    let mut file = open_document(&args.path)?;
    let shape_id = select_unique_shape(
        &mut file,
        args.shape_id.as_deref(),
        args.name.as_deref(),
        args.role.as_deref(),
    )?;
    let transaction = structured_transaction(
        &mut file,
        args.mutation.transaction_id,
        format!("shape:patch:{}", shape_id.as_str()),
        format!("patch shape {shape_id}"),
        vec![Operation::PatchShape { shape_id, patch, expected_version: args.expected_version.map(RecordVersion) }],
    )?;
    commit_mutation(&mut file, transaction, args.mutation.dry_run, json_output, stdout)
}

fn delete_shape(args: ShapeDeleteArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let mut file = open_document(&args.path)?;
    let shape_id = select_unique_shape(
        &mut file,
        args.shape_id.as_deref(),
        args.name.as_deref(),
        args.role.as_deref(),
    )?;
    let transaction = structured_transaction(
        &mut file,
        args.mutation.transaction_id,
        format!("shape:delete:{}", shape_id.as_str()),
        format!("delete shape {shape_id}"),
        vec![Operation::DeleteShape { shape_id, expected_version: args.expected_version.map(RecordVersion) }],
    )?;
    commit_mutation(&mut file, transaction, args.mutation.dry_run, json_output, stdout)
}
