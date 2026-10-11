//! Pet-only projections: never narrow notification or widget scheduling data.
use crate::{
    desktop::DesktopSettings,
    transport::{send, ApiRequest},
};
use serde_json::{json, Value};

pub fn project(
    items: Vec<Value>,
    range: &Value,
    overdue: bool,
    mut partial: bool,
) -> Result<Value, String> {
    let parse = |value: &Value| {
        value
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    };
    let start = parse(&range["start"]).ok_or("Invalid content window")?;
    let today = parse(&range["today"]).ok_or("Invalid content window")?;
    let end = parse(&range["end"]);
    let mut selected: Vec<Value> = items.into_iter().filter_map(|item| {
        if !item["completedAt"].is_null() || matches!(item["status"].as_str(), Some("completed" | "cancelled")) { return None; }
        let due = parse(&item["dueAt"]);
        let group = match due {
            Some(date) if date < today => if overdue { "overdue" } else { return None },
            Some(date) if date >= start && end.is_none_or(|end| date < end) => "upcoming",
            None if item["dueAt"].is_null() && end.is_none() => "undated",
            _ => return None,
        };
        Some(json!({"id":item["id"], "title":item["title"], "dueAt":item["dueAt"], "group":group}))
    }).collect();
    selected.sort_by(|a, b| {
        parse(&a["dueAt"])
            .cmp(&parse(&b["dueAt"]))
            .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
    });
    // Undated work follows scheduled work, not before overdue commitments.
    selected.sort_by_key(|item| item["group"] == "undated");
    partial |= selected.len() > 100;
    selected.truncate(100);
    Ok(json!({"items":selected,"range":range,"partial":partial}))
}
async fn get(
    app: &tauri::AppHandle,
    server: &str,
    account: &str,
    path: String,
) -> Result<Value, String> {
    let response = send(
        app,
        ApiRequest {
            server_url: server.into(),
            path,
            method: "GET".into(),
            body: None,
            expected_account_id: Some(account.into()),
        },
    )
    .await?;
    if response.status != 200 {
        return Err(format!(
            "Could not refresh quick access (HTTP {}).",
            response.status
        ));
    }
    serde_json::from_str(&response.body).map_err(|_| "Invalid quick-access response.".into())
}
async fn work(
    app: &tauri::AppHandle,
    server: &str,
    account: &str,
    kind: &str,
    range: &Value,
    overdue: bool,
) -> Result<Value, String> {
    let mut items = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = std::collections::HashSet::new();
    let mut partial = true;
    for _ in 0..20 {
        let path = {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            query.append_pair(
                if kind == "tasks" {
                    "lifecycle"
                } else {
                    "completed"
                },
                if kind == "tasks" { "open" } else { "false" },
            );
            query.append_pair("limit", "100");
            if let Some(end) = range["end"].as_str() {
                query.append_pair("dueBefore", end);
                if !overdue {
                    query.append_pair(
                        "dueAfter",
                        range["today"].as_str().ok_or("Invalid date window")?,
                    );
                }
            }
            if let Some(cursor) = &cursor {
                query.append_pair("cursor", cursor);
            }
            format!("/v1/{kind}?{}", query.finish())
        };
        let page = get(app, server, account, path).await?;
        items.extend(
            page["items"]
                .as_array()
                .ok_or("Invalid commitment response")?
                .iter()
                .cloned(),
        );
        match &page["nextCursor"] {
            Value::Null => {
                partial = false;
                break;
            }
            Value::String(next) if !next.is_empty() && seen.insert(next.clone()) => {
                cursor = Some(next.clone())
            }
            _ => return Err("Invalid commitment pagination.".into()),
        }
    }
    project(items, range, overdue, partial)
}
// Keep failures scoped to their source. No cached fallback may masquerade as a fresh section.
fn section(result: &mut Value, kind: &str, value: Result<Value, String>) {
    match value {
        Ok(value) => result[kind] = value,
        Err(_) => result["errors"][kind] = json!(true),
    }
}
async fn finance(
    app: &tauri::AppHandle,
    server: &str,
    account: &str,
    settings: &DesktopSettings,
    range: &Value,
) -> Result<Value, String> {
    if settings.pet_finance_window == "next30" {
        return Ok(
            json!({"range":range,"unavailable":"Scheduled outflows are not available for quick access."}),
        );
    }
    let path = {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        query.append_pair(
            "from",
            range["fromDate"].as_str().ok_or("Invalid finance range")?,
        );
        query.append_pair(
            "through",
            range["throughDate"]
                .as_str()
                .ok_or("Invalid finance range")?,
        );
        format!("/v1/finances/position?{}", query.finish())
    };
    let value = get(app, server, account, path).await?;
    let fact = &value["position"]["postedSpend"];
    if fact["quality"].as_str().is_none() {
        return Err("Invalid finance evidence.".into());
    }
    Ok(json!({"range":range,"facts":[fact],"asOf":value["position"]["asOf"]}))
}
pub async fn load(
    app: &tauri::AppHandle,
    server: &str,
    account: &str,
    settings: &DesktopSettings,
    ranges: &Value,
) -> Result<Value, String> {
    let mut result = json!({});
    for (kind, overdue) in [
        ("tasks", settings.pet_tasks_include_overdue),
        ("reminders", settings.pet_reminders_include_overdue),
    ] {
        if settings.pet_workspaces.iter().any(|w| w == kind) {
            section(
                &mut result,
                kind,
                work(app, server, account, kind, &ranges[kind], overdue).await,
            );
        }
    }
    if settings.pet_workspaces.iter().any(|w| w == "finances") {
        section(
            &mut result,
            "finances",
            finance(app, server, account, settings, &ranges["finances"]).await,
        );
    }
    if settings.pet_show_rituals {
        section(&mut result, "rituals", rituals(app, server, account).await);
    }
    Ok(result)
}
fn ritual_cards(
    state: &Value,
    history: &[Value],
    dates: &Value,
    now: chrono::DateTime<chrono::Utc>,
) -> Value {
    let instant = |value: &Value| {
        value
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
    };
    let stale =
        instant(&state["serverNow"]).is_none_or(|date| (now - date).num_seconds().abs() > 300);
    let mut cards = Vec::new();
    for definition in state["definitions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|d| d["enabled"] == true)
    {
        let id = &definition["id"];
        let current = &state["current"];
        let occurrence = if current["ritualId"] == *id {
            Some(current)
        } else {
            history
                .iter()
                .find(|o| {
                    o["ritualId"] == *id
                        && o["scheduledLocalDate"] == dates[id.as_str().unwrap_or("")]
                })
                .or_else(|| {
                    state["upcoming"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|o| o["ritualId"] == *id)
                })
        };
        let Some(occurrence) = occurrence else {
            continue;
        };
        let pending = occurrence["status"] == "pending";
        let due = instant(&occurrence["dueAt"]).is_some_and(|date| date <= now);
        let unexpired = instant(&occurrence["expiresAt"]).is_some_and(|date| date > now);
        let snoozed = instant(&occurrence["snoozedUntil"]).is_some_and(|date| date > now);
        let status = if pending && !due {
            "Scheduled"
        } else if pending && snoozed {
            "Snoozed"
        } else if pending && !unexpired {
            "Awaiting status"
        } else if pending {
            "Ready"
        } else {
            match occurrence["status"].as_str() {
                Some("completed") => "Completed",
                Some("skipped") => "Skipped",
                Some("missed") => "Missed",
                _ => "Unavailable",
            }
        };
        cards.push(json!({"id":occurrence["id"],"kind":definition["kind"],"logicalDate":occurrence["scheduledLocalDate"],"status":status,
          "urgent":pending && due && unexpired && !snoozed && !stale,"canOpen":pending && due && unexpired && !stale && occurrence["id"] == current["id"],
          "stale":stale,"syncStatus":state["syncStatus"]}));
    }
    json!(cards)
}
async fn rituals(app: &tauri::AppHandle, server: &str, account: &str) -> Result<Value, String> {
    let state = crate::ritual::pet_state(app, server, account).await?;
    let dates = crate::native::call(
        app,
        json!({"op":"pet_ritual_dates","definitions":state["definitions"]}),
    )
    .await?;
    let mut history = Vec::new();
    for definition in state["definitions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|d| d["enabled"] == true)
    {
        let date = dates[definition["id"].as_str().ok_or("Invalid ritual identity")?]
            .as_str()
            .ok_or("Invalid ritual date")?;
        let path = {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            query.append_pair(
                "kind",
                definition["kind"].as_str().ok_or("Invalid ritual kind")?,
            );
            query.append_pair("dateFrom", date);
            query.append_pair("dateTo", date);
            query.append_pair("limit", "100");
            format!("/v1/rituals/history?{}", query.finish())
        };
        let result = get(app, server, account, path).await?;
        if !result["nextCursor"].is_null() {
            return Err("Ritual history is incomplete. Open nohmi to view it.".into());
        }
        history.extend(
            result["items"]
                .as_array()
                .ok_or("Invalid ritual history")?
                .iter()
                .cloned(),
        );
    }
    Ok(ritual_cards(&state, &history, &dates, chrono::Utc::now()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn section_failures_preserve_successes_without_cached_fallbacks() {
        let mut content = json!({});
        section(&mut content, "tasks", Ok(json!({"items":[{"id":"task"}]})));
        for kind in ["reminders", "finances", "rituals"] {
            section(&mut content, kind, Err("provider unavailable".into()));
            assert_eq!(content["errors"][kind], true);
            assert!(content[kind].is_null());
        }
        assert_eq!(content["tasks"]["items"][0]["id"], "task");
        assert!(content["errors"]["tasks"].is_null());
    }
    #[test]
    fn rituals_preserve_logical_occurrence_and_disabled_configuration() {
        let state = json!({"serverNow":"2026-10-12T02:00:00Z","syncStatus":"saved",
          "definitions":[{"id":"night","kind":"night","enabled":true},{"id":"morning","kind":"morning","enabled":false}],
          "current":{"id":"occurrence","ritualId":"night","status":"pending","scheduledLocalDate":"2026-10-11","dueAt":"2026-10-12T01:00:00Z","expiresAt":"2026-10-12T10:00:00Z"}});
        let cards = ritual_cards(
            &state,
            &[],
            &json!({"night":"2026-10-12"}),
            chrono::DateTime::parse_from_rfc3339("2026-10-12T02:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        );
        assert_eq!(cards.as_array().unwrap().len(), 1);
        assert_eq!(cards[0]["id"], "occurrence");
        assert_eq!(cards[0]["urgent"], true);
        assert_eq!(cards[0]["logicalDate"], "2026-10-11");
        let stale = ritual_cards(
            &state,
            &[],
            &json!({}),
            chrono::DateTime::parse_from_rfc3339("2026-10-12T04:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        );
        assert_eq!(stale[0]["canOpen"], false);
        assert_eq!(stale[0]["stale"], true);
    }
    #[test]
    fn completed_history_and_future_windows_do_not_become_urgent() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-11T16:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let state = json!({"serverNow":now.to_rfc3339(),"syncStatus":"saved", "definitions":[{"id":"morning","kind":"morning","enabled":true},{"id":"night","kind":"night","enabled":true}],
          "upcoming":[{"id":"future","ritualId":"night","status":"pending","dueAt":"2026-10-12T01:00:00Z","expiresAt":"2026-10-12T11:00:00Z"}]});
        let history = vec![
            json!({"id":"done","ritualId":"morning","scheduledLocalDate":"2026-10-11","status":"completed"}),
        ];
        let cards = ritual_cards(&state, &history, &json!({"morning":"2026-10-11"}), now);
        assert_eq!(cards[0]["status"], "Completed");
        assert_eq!(cards[0]["urgent"], false);
        assert_eq!(cards[1]["status"], "Scheduled");
        assert_eq!(cards[1]["canOpen"], false);
    }
    fn range() -> Value {
        json!({"start":"2026-10-11T04:00:00Z","today":"2026-10-11T04:00:00Z","end":"2026-10-12T04:00:00Z"})
    }
    #[test]
    fn excludes_end_and_undated_and_separates_overdue() {
        let items = vec![
            json!({"id":"old","dueAt":"2026-10-10T10:00:00Z"}),
            json!({"id":"start","dueAt":"2026-10-11T04:00:00Z"}),
            json!({"id":"end","dueAt":"2026-10-12T04:00:00Z"}),
            json!({"id":"undated"}),
        ];
        let selected = project(items.clone(), &range(), true, false).unwrap();
        assert_eq!(selected["items"].as_array().unwrap().len(), 2);
        assert_eq!(selected["items"][0]["group"], "overdue");
        assert_eq!(
            project(items, &range(), false, false).unwrap()["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn filters_before_cap_and_labels_partial_results() {
        let mut items: Vec<Value> = (0..150)
            .map(|i| json!({"id":i.to_string(),"dueAt":"2026-10-12T04:00:00Z"}))
            .collect();
        items.push(json!({"id":"match","dueAt":"2026-10-11T05:00:00Z"}));
        let value = project(items, &range(), true, false).unwrap();
        assert_eq!(value["items"][0]["id"], "match");
        assert_eq!(value["partial"], false);
        assert_eq!(
            project(vec![], &range(), true, true).unwrap()["partial"],
            true
        );
    }
    #[test]
    fn all_upcoming_includes_undated_without_completed_items() {
        let mut range = range();
        range["end"] = Value::Null;
        let value = project(
            vec![
                json!({"id":"undated"}),
                json!({"id":"completed","completedAt":"2026-10-10T00:00:00Z"}),
            ],
            &range,
            false,
            false,
        )
        .unwrap();
        assert_eq!(value["items"].as_array().unwrap().len(), 1);
        assert_eq!(value["items"][0]["group"], "undated");
    }
}
