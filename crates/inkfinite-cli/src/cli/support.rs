use super::{
    ACTOR_ID, ActorId, Bounds, CliError, DocumentFile, EXIT_CONFLICT, EXIT_INPUT, EXIT_INVALID, EngineError, FileError,
    Path, Write, io,
};

pub fn open_document(path: &Path) -> Result<DocumentFile, CliError> {
    DocumentFile::open(path, ActorId::from(ACTOR_ID))
        .map_err(map_file_error)
        .map_err(|error| error.context(format!("could not open {}", portable_path(path))))
}

pub fn default_document_id(path: &Path) -> String {
    let displayed = portable_path(path);
    let filename = displayed.rsplit('/').next().unwrap_or("document");
    let stem = filename.strip_suffix(".inkfinite").unwrap_or(filename);
    let normalized: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() { "document:untitled".into() } else { format!("document:{normalized}") }
}

pub fn portable_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn parse_bounds(value: &str) -> Result<Bounds, String> {
    let values = value
        .split(',')
        .map(str::trim)
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "bounds must contain four numbers: x,y,width,height".to_owned())?;
    let [x, y, width, height] = values.as_slice() else {
        return Err("bounds must contain four numbers: x,y,width,height".into());
    };
    if !values.iter().all(|number| number.is_finite()) || *width < 0.0 || *height < 0.0 {
        return Err("bounds must be finite and width and height must be non-negative".into());
    }
    Ok(Bounds { x: *x, y: *y, width: *width, height: *height })
}

pub fn write_heads(stdout: &mut dyn Write, heads: &[inkfinite_core::ChangeHash]) -> Result<(), CliError> {
    writeln!(
        stdout,
        "Heads: {}",
        heads
            .iter()
            .map(inkfinite_core::ChangeHash::as_str)
            .collect::<Vec<_>>()
            .join(",")
    )
    .map_err(map_output_error)
}

pub fn write_json(stdout: &mut dyn Write, value: &impl serde::Serialize) -> Result<(), CliError> {
    serde_json::to_writer_pretty(&mut *stdout, value).map_err(map_json_error)?;
    writeln!(stdout).map_err(map_output_error)
}

pub fn map_file_error(error: FileError) -> CliError {
    let exit_code = match &error {
        FileError::AlreadyExists { .. } | FileError::Locked { .. } | FileError::SamePath { .. } => EXIT_CONFLICT,
        FileError::Engine(EngineError::StaleHeads | EngineError::Precondition(_) | EngineError::Permission(_)) => {
            EXIT_CONFLICT
        }
        FileError::Io { .. } | FileError::RecoveryNotFound { .. } => EXIT_INPUT,
        _ => EXIT_INVALID,
    };
    CliError::new(exit_code, error)
}

pub fn map_json_error(error: serde_json::Error) -> CliError {
    let exit_code = if error.is_io() { EXIT_INPUT } else { EXIT_INVALID };
    CliError::new(exit_code, error).context("could not write JSON output")
}

pub fn map_output_error(error: io::Error) -> CliError {
    CliError::new(EXIT_INPUT, error).context("could not write stdout")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_output_is_stable_for_unix_and_windows_conventions() {
        assert_eq!(
            portable_path(Path::new("boards/system.inkfinite")),
            "boards/system.inkfinite"
        );
        assert_eq!(
            portable_path(Path::new(r"boards\system.inkfinite")),
            "boards/system.inkfinite"
        );
        assert_eq!(
            default_document_id(Path::new(r"C:\boards\System Map.inkfinite")),
            "document:system-map"
        );
    }

    #[test]
    fn bounds_require_four_finite_values_and_non_negative_size() {
        assert_eq!(
            parse_bounds("1,2,3,4").unwrap(),
            Bounds { x: 1.0, y: 2.0, width: 3.0, height: 4.0 }
        );
        assert!(parse_bounds("1,2,-3,4").is_err());
        assert!(parse_bounds("1,2,3").is_err());
        assert!(parse_bounds("1,2,NaN,4").is_err());
    }
}
