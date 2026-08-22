use super::mutation::{StructuredMutationTarget, select_unique_shape};
use super::{
    BindingAnchor, BindingId, BindingKind, BindingRecord, CliError, ConnectArgs, EXIT_INVALID, Operation,
    RecordVersion, Write, anyhow,
};

pub fn connect_shapes(args: ConnectArgs, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
    let snapshot = target.snapshot()?;
    let source = select_unique_shape(
        &snapshot.document,
        args.source.as_deref(),
        None,
        args.source_role.as_deref(),
    )?;
    let target_shape = select_unique_shape(
        &snapshot.document,
        args.target.as_deref(),
        None,
        args.target_role.as_deref(),
    )?;
    let anchor = match (args.anchor_x, args.anchor_y) {
        (None, None) => BindingAnchor::Center,
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => BindingAnchor::Edge { x, y },
        (Some(_), Some(_)) => {
            return Err(CliError::new(
                EXIT_INVALID,
                anyhow!("binding anchor coordinates must be finite"),
            ));
        }
        _ => {
            return Err(CliError::new(
                EXIT_INVALID,
                anyhow!("binding anchor needs both coordinates"),
            ));
        }
    };
    let binding_id = match args.binding_id {
        Some(binding_id) => BindingId::from(binding_id),
        None => {
            let mut suffix = 1_u64;
            loop {
                let candidate = BindingId::from(format!("binding:{suffix}"));
                if !snapshot.document.bindings.contains_key(&candidate) {
                    break candidate;
                }
                suffix = suffix.saturating_add(1);
            }
        }
    };
    let binding = BindingRecord {
        id: binding_id.clone(),
        kind: BindingKind::from(args.kind),
        source_shape_id: source,
        target_shape_id: target_shape,
        source_handle: args.source_handle,
        anchor,
        relation_type: args.relation_type,
        version: RecordVersion(1),
    };
    let transaction = target.transaction(
        args.mutation.transaction_id.clone(),
        format!("connect:{}", binding_id.as_str()),
        format!("create binding {binding_id}"),
        vec![Operation::CreateBinding { binding }],
    )?;
    target.finish(transaction, &args.mutation, json_output, stdout)
}
