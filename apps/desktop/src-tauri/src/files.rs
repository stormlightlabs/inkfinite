use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const MAX_INTERCHANGE_BYTES: usize = 16 * 1024 * 1024;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

/// UTF-8 contents selected from an external editable canvas file.
#[derive(serde::Serialize)]
pub struct InterchangeFile {
    /// File name shown to the user.
    pub name: String,
    /// Complete JSON source.
    pub contents: String,
}

/// Read directory contents and return matching files
#[tauri::command]
pub fn read_directory(directory: String, pattern: Option<String>) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&directory);
    if !path.exists() {
        return Err(format!("Directory does not exist: {directory}"));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {directory}"));
    }

    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {e}"))?;

    let mut results = Vec::new();
    let pattern = pattern.unwrap_or_else(|| "*.inkfinite".to_string());

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let entry_path = entry.path();
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {e}"))?;

        let name = entry.file_name().to_string_lossy().to_string();

        if metadata.is_file() {
            let suffix = pattern.strip_prefix('*').unwrap_or(&pattern);
            if !name.ends_with(suffix) {
                continue;
            }
        }

        results.push(FileEntry { path: entry_path.to_string_lossy().to_string(), name, is_dir: metadata.is_dir() });
    }

    // Sort: directories first, then files, alphabetically
    results.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(results)
}

/// Rename a file
#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let old = Path::new(&old_path);
    let new = Path::new(&new_path);

    if !old.exists() {
        return Err(format!("Source file does not exist: {old_path}"));
    }

    fs::rename(old, new).map_err(|e| format!("Failed to rename file: {e}"))?;

    Ok(())
}

/// Delete a file
#[tauri::command]
pub fn delete_file(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("File does not exist: {file_path}"));
    }

    if path.is_dir() {
        return Err(format!("Path is a directory, not a file: {file_path}"));
    }

    fs::remove_file(path).map_err(|e| format!("Failed to delete file: {e}"))?;

    Ok(())
}

/// Opens the native document picker and returns the selected Inkfinite path.
#[tauri::command]
pub async fn pick_open_document(app: AppHandle) -> Result<Option<String>, String> {
    log::info!("opening native document picker");
    let selected = app
        .dialog()
        .file()
        .add_filter("Inkfinite Files", &["inkfinite"])
        .blocking_pick_file();
    let path = selected
        .map(|path| path.into_path().map(|path| path.to_string_lossy().into_owned()))
        .transpose()
        .map_err(|error| {
            log::error!("failed to resolve the selected document path: {error}");
            format!("Failed to resolve selected document: {error}")
        })?;
    match &path {
        Some(path) => log::info!("native document picker selected {path}"),
        None => log::info!("native document picker was cancelled"),
    }
    Ok(path)
}

/// Opens the native Save dialog and returns the selected Inkfinite path.
#[tauri::command]
pub async fn pick_save_document(app: AppHandle, default_name: Option<String>) -> Result<Option<String>, String> {
    log::info!("opening native Save dialog with default name {:?}", default_name);
    let dialog = app.dialog().file().add_filter("Inkfinite Files", &["inkfinite"]);
    let selected = match default_name {
        Some(name) => dialog.set_file_name(name),
        None => dialog,
    }
    .blocking_save_file();
    let path = selected
        .map(|path| path.into_path().map(|path| path.to_string_lossy().into_owned()))
        .transpose()
        .map_err(|error| {
            log::error!("failed to resolve the selected Save path: {error}");
            format!("Failed to resolve selected Save path: {error}")
        })?;
    match &path {
        Some(path) => log::info!("native Save dialog selected {path}"),
        None => log::info!("native Save dialog was cancelled"),
    }
    Ok(path)
}

/// Opens an external editable canvas document and returns its UTF-8 contents.
#[tauri::command]
pub async fn pick_interchange_document(app: AppHandle) -> Result<Option<InterchangeFile>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Editable Canvas Files", &["excalidraw", "canvas"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("Failed to resolve selected import path: {error}"))?;
    let metadata = fs::metadata(&path).map_err(|error| format!("Failed to inspect selected import: {error}"))?;
    if metadata.len() > MAX_INTERCHANGE_BYTES as u64 {
        return Err("The selected file is larger than the 16 MB import limit.".into());
    }
    let contents =
        fs::read_to_string(&path).map_err(|error| format!("Failed to read selected import as UTF-8 JSON: {error}"))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Imported canvas".into());
    Ok(Some(InterchangeFile { name, contents }))
}

/// Saves an external editable canvas export without changing the canonical document path.
#[tauri::command]
pub async fn save_interchange_document(
    app: AppHandle, default_name: String, extension: String, contents: String,
) -> Result<bool, String> {
    let allowed = matches!(extension.as_str(), "excalidraw" | "canvas");
    if !allowed {
        return Err(format!("Unsupported export extension: {extension}"));
    }
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Editable Canvas File", &[extension.as_str()])
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let mut path = selected
        .into_path()
        .map_err(|error| format!("Failed to resolve selected export path: {error}"))?;
    if path.extension().is_none() {
        path.set_extension(&extension);
    }
    fs::write(&path, contents).map_err(|error| format!("Failed to save editable canvas export: {error}"))?;
    Ok(true)
}

/// Pick a workspace directory using the system folder picker
#[tauri::command]
pub async fn pick_workspace_directory(app: AppHandle) -> Result<Option<String>, String> {
    log::info!("opening native workspace directory picker");
    let result = app.dialog().file().blocking_pick_folder();

    match result {
        Some(path) => path
            .into_path()
            .map(|path| Some(path.to_string_lossy().into_owned()))
            .map_err(|error| format!("Failed to resolve selected directory: {error}")),
        None => Ok(None),
    }
}
