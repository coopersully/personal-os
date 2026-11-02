//! Device preferences are namespaced by authenticated server/account, never shared by sign-ins.
use crate::desktop::DesktopSettings;
use serde_json::{json, Value};
use std::{
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};
fn path(root: &Path, server: &str, account: &str) -> PathBuf {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    (server, account).hash(&mut hash);
    root.with_file_name(format!("preferences-{:016x}.json", hash.finish()))
}
pub fn save(root: &Path, settings: &DesktopSettings, account: &str) -> Result<(), String> {
    let destination = path(root, &settings.server_url, account);
    let temporary = destination.with_extension("tmp");
    let value = json!({"serverUrl":settings.server_url,"accountId":account,"settings":settings});
    std::fs::write(&temporary, value.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(temporary, destination).map_err(|e| e.to_string())
}
pub fn load(root: &Path, current: &DesktopSettings, account: &str) -> DesktopSettings {
    let stored = std::fs::read(path(root, &current.server_url, account))
        .ok()
        .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
        .filter(|s| s["serverUrl"] == current.server_url && s["accountId"] == account)
        .and_then(|s| serde_json::from_value::<DesktopSettings>(s["settings"].clone()).ok())
        .filter(|s| {
            let mut candidate = s.clone();
            candidate.validate().is_ok()
        });
    let mut next = stored.unwrap_or_default();
    next.server_url = current.server_url.clone();
    next.launch_at_login = current.launch_at_login; // Login registration belongs to the installation.
    next
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preferences_do_not_cross_accounts_or_origins() {
        let directory =
            std::env::temp_dir().join(format!("personal-os-preferences-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let root = directory.join("desktop.json");
        let mut first = DesktopSettings::default();
        first.pet_enabled = true;
        first.notifications.preview = true;
        first.launch_at_login = true;
        save(&root, &first, "first").unwrap();
        assert!(load(&root, &first, "first").pet_enabled);
        let other = load(&root, &first, "second");
        assert!(!other.pet_enabled);
        assert!(!other.notifications.preview);
        assert!(other.launch_at_login);
        first.server_url = "https://custom.test".into();
        assert!(!load(&root, &first, "first").pet_enabled);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(test)]
mod active_card_tests {
    use crate::desktop::DesktopSettings;
    #[test]
    fn active_card_preferences_default_validate_and_round_trip() {
        let mut value: DesktopSettings = serde_json::from_str("{}").unwrap();
        assert!(value.active_card_interactions.shake);
        assert!(value.active_card_interactions.snapping);
        assert!(!value.active_card_interactions.auto_lock);
        value.active_card_interactions.sensitivity = "high".into();
        value.active_card_interactions.volume = 0.5;
        value.validate().unwrap();
        let restored: DesktopSettings =
            serde_json::from_value(serde_json::to_value(&value).unwrap()).unwrap();
        assert_eq!(restored.active_card_interactions.sensitivity, "high");
        assert_eq!(restored.active_card_interactions.volume, 0.5);
        assert_eq!(restored.notifications.preview, value.notifications.preview);
        for volume in [-0.1, 1.1, f64::NAN] {
            value.active_card_interactions.volume = volume;
            assert!(value.validate().is_err());
        }
        value.active_card_interactions.volume = 0.35;
        value.active_card_interactions.sensitivity = "invalid".into();
        assert!(value.validate().is_err());
    }
}

#[cfg(test)]
mod expanded_active_card_tests {
    use crate::desktop::DesktopSettings;
    #[test]
    fn old_preferences_keep_values_and_new_fields_validate() {
        let mut settings: DesktopSettings =
            serde_json::from_str(r#"{"activeCardInteractions":{"shake":false,"volume":0.7}}"#)
                .unwrap();
        assert!(!settings.active_card_interactions.shake);
        assert_eq!(settings.active_card_interactions.volume, 0.7);
        assert_eq!(settings.active_card_interactions.anchor, "top-right");
        assert_eq!(settings.active_card_interactions.magnet, "eager");
        assert!(!settings.active_card_interactions.respect_focus);
        settings.active_card_interactions.starting_display =
            "11111111-2222-3333-4444-555555555555".into();
        settings.active_card_interactions.edge_spacing = 40.0;
        settings.active_card_interactions.completion_volume = 0.0;
        settings.validate().unwrap();
        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(value["activeCardInteractions"]["edgeSpacing"], 40.0);
        for (field, invalid) in [
            ("edgeSpacing", serde_json::json!(41)),
            ("arrivalVolume", serde_json::json!(-0.1)),
            ("completionVolume", serde_json::json!(1.1)),
            ("interactionVolume", serde_json::json!(-1)),
            ("anchor", serde_json::json!("invalid")),
            ("magnet", serde_json::json!("invalid")),
            ("textScale", serde_json::json!("invalid")),
            ("titleLines", serde_json::json!("invalid")),
            ("countdown", serde_json::json!("invalid")),
            ("startingDisplay", serde_json::json!("fake-display")),
        ] {
            let mut candidate = value.clone();
            candidate["activeCardInteractions"][field] = invalid;
            let mut candidate: DesktopSettings = serde_json::from_value(candidate).unwrap();
            assert!(candidate.validate().is_err(), "{field}");
        }
    }
}
