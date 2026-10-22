use serde_json::{json, Value};
use std::{collections::HashSet, future::Future};
#[derive(Default)]
pub struct ActiveReminderRuntime {
    pub refresh: tokio::sync::Notify,
}
async fn collect_candidates<F, R>(mut fetch: F) -> Result<Value, String>
where
    F: FnMut(String) -> R,
    R: Future<Output = Result<Value, String>>,
{
    let mut cursor: Option<String> = None;
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    let mut generated_at: Option<Value> = None;
    loop {
        let mut path = "/v1/desktop/active-reminders?limit=100".to_string();
        if let Some(ref cursor) = cursor {
            path.push_str("&cursor=");
            path.push_str(
                &url::form_urlencoded::byte_serialize(cursor.as_bytes()).collect::<String>(),
            );
        }
        let page = fetch(path).await?;
        let stamp = page
            .get("generatedAt")
            .filter(|s| {
                s.as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .is_some()
            })
            .ok_or("Invalid active reminder timestamp")?;
        if let Some(ref expected) = generated_at {
            if expected != stamp {
                return Err("Active reminder page identity changed".into());
            }
        } else {
            generated_at = Some(stamp.clone());
        }
        items.extend(
            page["items"]
                .as_array()
                .ok_or("Invalid active reminder page")?
                .iter()
                .cloned(),
        );
        // Native dispatch has an explicit one-MiB bound; fail rather than silently truncate material.
        if serde_json::to_vec(&items).map_err(|e| e.to_string())?.len() > 900_000 {
            return Err("Active reminder inventory exceeds the native message limit".into());
        }
        match page.get("nextCursor") {
            Some(Value::Null) => return Ok(json!({"generatedAt":generated_at,"items":items})),
            Some(Value::String(next)) if !next.is_empty() && seen.insert(next.clone()) => {
                cursor = Some(next.clone())
            }
            _ => return Err("Invalid or repeated active reminder cursor".into()),
        }
    }
}
// Absence from the active feed is not proof of completion: opt-out and due-time edits
// must hand current source material back to ordinary delivery. Resolve at most eight
// owner-bound reads concurrently; one failed read retains the previous native inventory.
async fn resolve_removed<F, R>(
    previous: &Value,
    next: &Value,
    mut fetch: F,
) -> Result<Vec<Value>, String>
where
    F: FnMut(String) -> R,
    R: Future<Output = Result<(u16, Value), String>> + Send + 'static,
{
    let present: HashSet<String> = next["items"]
        .as_array()
        .ok_or("Invalid inventory")?
        .iter()
        .map(|item| format!("{}:{}", item["kind"], item["id"]))
        .collect();
    let removed: Vec<Value> = previous["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| !present.contains(&format!("{}:{}", item["kind"], item["id"])))
        .cloned()
        .collect();
    let mut ordinary = Vec::new();
    for batch in removed.chunks(8) {
        let mut reads = tokio::task::JoinSet::new();
        for item in batch {
            let kind = item["kind"]
                .as_str()
                .ok_or("Invalid source kind")?
                .to_string();
            let id = item["id"].as_str().ok_or("Invalid source ID")?.to_string();
            // Reuse action identity validation before ever constructing a source path.
            completion_request(item)?;
            let read = fetch(format!("/v1/{kind}s/{id}"));
            reads.spawn(async move { (kind, id, read.await) });
        }
        while let Some(read) = reads.join_next().await {
            let (kind, id, response) = read.map_err(|_| "Source refresh interrupted")?;
            let (status, payload) = response?;
            if status == 404 {
                continue;
            }
            if status != 200 {
                return Err("Source refresh failed".into());
            }
            let record = &payload[&kind];
            if record["id"] != id {
                return Err("Source identity changed".into());
            }
            if record["completedAt"].is_string()
                || record["deletedAt"].is_string()
                || (kind == "task" && record["lifecycle"] != "open")
            {
                continue;
            }
            if record["dueAt"].is_null() {
                continue;
            }
            let mut candidate = json!({"kind":kind, "id":id, "title":record["title"],
                "dueAt":record["dueAt"], "activeReminder":record["activeReminder"]});
            if kind == "task" {
                candidate["revision"] = record["revision"].clone();
            } else {
                candidate["updatedAt"] = record["updatedAt"].clone();
            }
            completion_request(&candidate)?;
            if !candidate["title"].is_string() || !candidate["activeReminder"].is_boolean() {
                return Err("Invalid source refresh".into());
            }
            ordinary.push(candidate);
        }
    }
    Ok(ordinary)
}
pub async fn run(app: tauri::AppHandle) {
    use crate::{
        desktop::DesktopState,
        transport::{send, ApiRequest},
    };
    use std::sync::atomic::Ordering;
    use tauri::Manager;
    let state = app.state::<DesktopState>();
    let runtime = app.state::<ActiveReminderRuntime>();
    let mut changed = state.changed.subscribe();
    let mut previous = Value::Null;
    let mut previous_identity = None;
    loop {
        let settings = state.settings.lock().await.clone();
        let generation = state.generation.load(Ordering::SeqCst);
        let account = state.account_id.lock().await.clone();
        if settings.notifications.enabled {
            if let Some(account) = account {
                let identity = (settings.server_url.clone(), account.clone(), generation);
                if previous_identity.as_ref() != Some(&identity) {
                    previous = Value::Null;
                }
                let result = collect_candidates(|path| {
                    let app = &app;
                    let server = settings.server_url.clone();
                    let account = account.clone();
                    async move {
                        let response = send(
                            app,
                            ApiRequest {
                                path,
                                method: "GET".into(),
                                body: None,
                                server_url: server,
                                expected_account_id: Some(account),
                            },
                        )
                        .await?;
                        if response.status != 200 {
                            return Err(format!(
                                "Active reminder refresh returned HTTP {}",
                                response.status
                            ));
                        }
                        serde_json::from_str(&response.body)
                            .map_err(|_| "Invalid active reminder response".into())
                    }
                })
                .await;
                let result = match result {
                    Ok(mut inventory) => {
                        let app_for_read = app.clone();
                        let server_for_read = settings.server_url.clone();
                        let account_for_read = account.clone();
                        resolve_removed(&previous, &inventory, move |path| {
                            let app = app_for_read.clone();
                            let server = server_for_read.clone();
                            let account = account_for_read.clone();
                            async move {
                                let response = send(
                                    &app,
                                    ApiRequest {
                                        path,
                                        method: "GET".into(),
                                        body: None,
                                        server_url: server,
                                        expected_account_id: Some(account),
                                    },
                                )
                                .await?;
                                let payload = if response.status == 200 {
                                    serde_json::from_str(&response.body)
                                        .map_err(|_| "Invalid source response")?
                                } else {
                                    Value::Null
                                };
                                Ok((response.status, payload))
                            }
                        })
                        .await
                        .map(|ordinary| {
                            inventory["ordinaryItems"] = json!(ordinary);
                            inventory
                        })
                    }
                    Err(error) => Err(error),
                };
                let current = state.settings.lock().await;
                if current.server_url == settings.server_url
                    && state.generation.load(Ordering::SeqCst) == generation
                    && state.account_id.lock().await.as_deref() == Some(&account)
                {
                    match result {
                        Ok(mut inventory) => {
                            inventory["serverUrl"] = json!(settings.server_url);
                            inventory["accountId"] = json!(account);
                            inventory["generation"] = json!(generation);
                            if crate::native::call(
                                &app,
                                json!({"op":"active_reminders_snapshot","inventory":inventory}),
                            )
                            .await
                            .is_ok()
                            {
                                previous = inventory;
                                previous_identity = Some(identity);
                            }
                        }
                        Err(_) => {
                            let _=crate::native::call(&app,json!({"op":"active_reminders_error","message":"Active reminders could not refresh. Check your connection."})).await;
                        }
                    }
                }
            }
        }
        let active = crate::native::call(&app, json!({"op":"status"}))
            .await
            .ok()
            .is_some_and(|s| s["activeRemindersActive"] == true);
        tokio::select! {_=tokio::time::sleep(std::time::Duration::from_secs(if active {10}else{60}))=>{},_=runtime.refresh.notified()=>{},_=changed.changed()=>{}}
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn active_reminders_paging_keeps_all_205_items() {
        let mut pages = vec![
            json!({"generatedAt":"2026-10-22T12:00:00Z","items":(0..100).map(|i|json!({"id":i})).collect::<Vec<_>>(),"nextCursor":"next"}),
            json!({"generatedAt":"2026-10-22T12:00:00Z","items":(100..205).map(|i|json!({"id":i})).collect::<Vec<_>>(),"nextCursor":null}),
        ].into_iter();
        let result = collect_candidates(|_| std::future::ready(Ok(pages.next().unwrap())))
            .await
            .unwrap();
        assert_eq!(result["items"].as_array().unwrap().len(), 205);
    }
    #[tokio::test]
    async fn active_reminders_partial_failure_never_publishes_empty_success() {
        let mut call = 0;
        let result = collect_candidates(|_| {
            call += 1;
            std::future::ready(if call == 1 {
                Ok(json!({"generatedAt":"2026-10-22T12:00:00Z","items":[],"nextCursor":"next"}))
            } else {
                Err("offline".into())
            })
        })
        .await;
        assert!(result.is_err());
    }
    #[tokio::test]
    async fn removed_sources_are_resolved_before_retirement() {
        let old = json!({"items":[{"kind":"task","id":"11111111-1111-4111-8111-111111111111","dueAt":"2026-10-22T12:00:00Z","revision":1},
            {"kind":"reminder","id":"22222222-2222-4222-8222-222222222222","dueAt":"2026-10-22T12:00:00Z","updatedAt":"2026-10-22T11:00:00Z"}]});
        let next = json!({"items":[]});
        let ordinary = resolve_removed(&old, &next, |path| {
            std::future::ready(Ok(if path.contains("/tasks/") {
                (
                    200,
                    json!({"task":{
                        "id":"11111111-1111-4111-8111-111111111111", "title":"Current title",
                        "dueAt":"2026-10-22T12:00:00Z", "activeReminder":false,
                        "lifecycle":"open", "deletedAt":null, "completedAt":null, "revision":2
                    }}),
                )
            } else {
                (404, Value::Null)
            }))
        })
        .await
        .unwrap();
        assert_eq!(ordinary.len(), 1);
        assert_eq!(ordinary[0]["activeReminder"], false);
        assert_eq!(ordinary[0]["revision"], 2);
        assert_eq!(ordinary[0]["title"], "Current title");
        assert!(
            resolve_removed(&old, &next, |_| std::future::ready(Err("offline".into())))
                .await
                .is_err()
        );
        let completed = resolve_removed(&old, &next, |_| std::future::ready(Ok((200,
            json!({"task":{"id":"11111111-1111-4111-8111-111111111111","completedAt":"2026-10-22T12:00:00Z"},
                   "reminder":{"id":"22222222-2222-4222-8222-222222222222","completedAt":"2026-10-22T12:00:00Z"}})
        )))).await.unwrap();
        assert!(completed.is_empty());
    }
    #[tokio::test]
    async fn active_reminders_repeated_cursor_fails_closed() {
        let result = collect_candidates(|_| {
            std::future::ready(Ok(
                json!({"generatedAt":"2026-10-22T12:00:00Z","items":[],"nextCursor":"repeated"}),
            ))
        })
        .await;
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod action_tests {
    use super::*;
    #[test]
    fn active_reminders_completion_preserves_source_revision() {
        let task = json!({"kind":"task","id":"11111111-1111-4111-8111-111111111111","dueAt":"2026-10-22T12:00:00Z","revision":7});
        let (path, body) = completion_request(&task).unwrap();
        assert_eq!(
            path,
            "/v1/tasks/11111111-1111-4111-8111-111111111111/complete"
        );
        assert_eq!(body, json!({"expectedRevision":7}));
        let reminder = json!({"kind":"reminder","id":task["id"],"dueAt":task["dueAt"],"updatedAt":"2026-10-22T11:00:00Z"});
        assert_eq!(
            completion_request(&reminder).unwrap().1,
            json!({"completed":true,"expectedUpdatedAt":"2026-10-22T11:00:00Z"})
        );
        assert!(
            completion_request(&json!({"kind":"task","id":task["id"],"dueAt":task["dueAt"]}))
                .is_err()
        );
        assert!(completion_request(&json!({"kind":"mail","id":"../other"})).is_err());
    }
}

fn completion_request(value: &Value) -> Result<(String, Value), String> {
    let kind = value["kind"].as_str().ok_or("Missing source type")?;
    let id = value["id"].as_str().ok_or("Missing source ID")?;
    if !["task", "reminder"].contains(&kind)
        || id.len() != 36
        || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
        || chrono::DateTime::parse_from_rfc3339(value["dueAt"].as_str().unwrap_or("")).is_err()
    {
        return Err("Invalid source identity".into());
    }
    let body = if kind == "task" {
        let revision = value["revision"]
            .as_u64()
            .filter(|r| *r > 0)
            .ok_or("Missing task revision")?;
        json!({"expectedRevision":revision})
    } else {
        let revision = value["updatedAt"]
            .as_str()
            .filter(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
            .ok_or("Missing reminder revision")?;
        json!({"completed":true,"expectedUpdatedAt":revision})
    };
    Ok((format!("/v1/{kind}s/{id}/complete"), body))
}
pub async fn complete(app: tauri::AppHandle, value: Value) {
    use crate::{
        desktop::DesktopState,
        transport::{send, ApiRequest},
    };
    use std::sync::atomic::Ordering;
    use tauri::{Emitter, Manager};
    let state = app.state::<DesktopState>();
    let generation = value["generation"].as_u64();
    let server = value["serverUrl"].as_str().unwrap_or("");
    let account = value["accountId"].as_str().unwrap_or("");
    {
        let settings = state.settings.lock().await;
        if generation != Some(state.generation.load(Ordering::SeqCst))
            || settings.server_url != server
            || state.account_id.lock().await.as_deref() != Some(account)
        {
            return;
        }
    }
    let result = async {
        let (path, body) = completion_request(&value)?;
        send(
            &app,
            ApiRequest {
                path,
                body: Some(body.to_string()),
                method: "POST".into(),
                server_url: server.into(),
                expected_account_id: Some(account.into()),
            },
        )
        .await
    }
    .await;
    let outcome = match result {
        Ok(ref response) if response.status == 409 => "conflict",
        Ok(ref response) if (200..300).contains(&response.status) => {
            let payload: Value = serde_json::from_str(&response.body).unwrap_or(Value::Null);
            let record = &payload[value["kind"].as_str().unwrap_or("")];
            if record["id"] == value["id"]
                && (record["lifecycle"] == "completed" || record["completedAt"].is_string())
            {
                "completed"
            } else {
                "failed"
            }
        }
        _ => "failed",
    };
    let settings = state.settings.lock().await;
    if generation == Some(state.generation.load(Ordering::SeqCst))
        && settings.server_url == server
        && state.account_id.lock().await.as_deref() == Some(account)
    {
        let mut result = value.clone();
        result["op"] = json!("active_reminder_action_result");
        result["outcome"] = json!(outcome);
        let _ = crate::native::call(&app, result).await;
        if outcome == "completed" {
            let _ = app.emit("desktop-material-changed", ());
        }
        app.state::<ActiveReminderRuntime>().refresh.notify_one();
        state.refresh.notify_one();
    }
}
