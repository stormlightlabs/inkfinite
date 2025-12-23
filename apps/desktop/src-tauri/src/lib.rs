use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

/// Read directory contents and return matching files
#[tauri::command]
fn read_directory(directory: String, pattern: Option<String>) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&directory);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", directory));
    }

    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut results = Vec::new();
    let pattern = pattern.unwrap_or_else(|| "*.inkfinite.json".to_string());

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let name = entry.file_name().to_string_lossy().to_string();

        if metadata.is_file() {
            if pattern.contains('*') {
                let pattern_without_star = pattern.replace('*', "");
                if !name.contains(&pattern_without_star) {
                    continue;
                }
            } else if !name.ends_with(&pattern) {
                continue;
            }
        }

        results.push(FileEntry {
            path: entry_path.to_string_lossy().to_string(),
            name,
            is_dir: metadata.is_dir(),
        });
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
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let old = Path::new(&old_path);
    let new = Path::new(&new_path);

    if !old.exists() {
        return Err(format!("Source file does not exist: {}", old_path));
    }

    fs::rename(old, new).map_err(|e| format!("Failed to rename file: {}", e))?;

    Ok(())
}

/// Delete a file
#[tauri::command]
fn delete_file(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    if path.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", file_path));
    }

    fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(())
}

/// Pick a workspace directory using the system folder picker
#[tauri::command]
async fn pick_workspace_directory(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

    let result = app.dialog().file().blocking_pick_folder();

    match result {
        Some(path) => Ok(Some(path.to_string_lossy().to_string())),
        None => Ok(None),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            read_directory,
            rename_file,
            delete_file,
            pick_workspace_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
