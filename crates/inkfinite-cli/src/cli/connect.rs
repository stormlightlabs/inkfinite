use super::mutation::{commit_mutation, select_unique_shape, structured_transaction};
use super::support::open_document;
use super::{
    BindingAnchor, BindingId, BindingKind, BindingRecord, CliError, ConnectArgs, EXIT_INVALID, Operation,
    RecordVersion, Write, anyhow,
};

pub fn connect_shapes(args: ConnectArgs, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    let mut file = open_document(&args.path)?;
    let source = select_unique_shape(&mut file, args.source.as_deref(), None, args.source_role.as_deref())?;
    let target = select_unique_shape(&mut file, args.target.as_deref(), None, args.target_role.as_deref())?;
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
    let binding_id = BindingId::from(args.binding_id);
    let binding = BindingRecord {
        id: binding_id.clone(),
        kind: BindingKind::from(args.kind),
        source_shape_id: source,
        target_shape_id: target,
        source_handle: args.source_handle,
        anchor,
        version: RecordVersion(1),
    };
    let transaction = structured_transaction(
        &mut file,
        args.mutation.transaction_id,
        format!("connect:{}", binding_id.as_str()),
        format!("create binding {binding_id}"),
        vec![Operation::CreateBinding { binding }],
    )?;
    commit_mutation(&mut file, transaction, args.mutation.dry_run, json_output, stdout)
}
