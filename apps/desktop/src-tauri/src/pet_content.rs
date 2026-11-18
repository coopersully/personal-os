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
    let fact = finance_fact(&value["position"]["postedSpend"])?;
    Ok(json!({"range":range,"facts":[fact],"asOf":value["position"]["asOf"]}))
}
// Validate the consumed public money-fact contract before publishing it to the webview.
fn finance_fact(value: &Value) -> Result<Value, String> {
    let reasons = value["reasons"]
        .as_array()
        .ok_or("Invalid finance reasons.")?;
    let valid_reason = |reason: &Value| {
        matches!(
            reason.as_str(),
            Some(
                "dependency_unavailable"
                    | "source_unavailable"
                    | "stale_evidence"
                    | "incomplete_evidence"
                    | "pending_transactions"
                    | "unresolved_allocation"
                    | "unresolved_reimbursement"
                    | "missing_commitments"
                    | "missing_protection_policy"
                    | "unsupported_account_type"
            )
        )
    };
    if value["currency"] != "USD"
        || !matches!(
            value["quality"].as_str(),
            Some("verified" | "qualified" | "unavailable")
        )
        || !value.get("cents").is_some_and(|cents| {
            cents.is_null()
                || cents.as_i64().is_some_and(|amount| {
                    (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&amount)
                })
        })
        || reasons.len() > 20
        || !reasons.iter().all(valid_reason)
    {
        return Err("Invalid finance evidence.".into());
    }
    Ok(
        json!({"currency":value["currency"],"quality":value["quality"],"cents":value["cents"],"reasons":reasons}),
    )
}
async fn bounded_section(
    enabled: bool,
    budget: std::time::Duration,
    load: impl std::future::Future<Output = Result<Value, String>>,
) -> Option<Result<Value, String>> {
    if !enabled {
        return None;
    }
    Some(
        tokio::time::timeout(budget, load)
            .await
            .unwrap_or_else(|_| Err("Quick-access section timed out.".into())),
    )
}
pub async fn load(
    app: &tauri::AppHandle,
    server: &str,
    account: &str,
    settings: &DesktopSettings,
    ranges: &Value,
) -> Result<Value, String> {
    let enabled = |kind| settings.pet_workspaces.iter().any(|w| w == kind);
    // One slow source must not consume a fresh timeout before each healthy sibling starts.
    let budget = std::time::Duration::from_secs(10);
    let (tasks, reminders, finances, ritual_cards) = tokio::join!(
        bounded_section(
            enabled("tasks"),
            budget,
            work(
                app,
                server,
                account,
                "tasks",
                &ranges["tasks"],
                settings.pet_tasks_include_overdue
            )
        ),
        bounded_section(
            enabled("reminders"),
            budget,
            work(
                app,
                server,
                account,
                "reminders",
                &ranges["reminders"],
                settings.pet_reminders_include_overdue
            )
        ),
        bounded_section(
            enabled("finances"),
            budget,
            finance(app, server, account, settings, &ranges["finances"])
        ),
        bounded_section(
            settings.pet_show_rituals,
            budget,
            rituals(app, server, account)
        ),
    );
    let mut result = json!({});
    for (kind, value) in [
        ("tasks", tasks),
        ("reminders", reminders),
        ("finances", finances),
        ("rituals", ritual_cards),
    ] {
        if let Some(value) = value {
            section(&mut result, kind, value);
        }
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
    // Sync owns durable queued writes and its runtime lock. A UI deadline may stop observing it,
    // but must not release that lock while a native persistence operation is still finishing.
    let sync_app = app.clone();
    let sync_server = server.to_owned();
    let sync_account = account.to_owned();
    let state = tauri::async_runtime::spawn(async move {
        crate::ritual::pet_state(&sync_app, &sync_server, &sync_account).await
    })
    .await
    .map_err(|_| "Could not refresh ritual state.".to_owned())??;
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
    #[tokio::test]
    async fn stalled_section_has_a_deadline_while_healthy_siblings_start() {
        let (started, healthy_started) = tokio::sync::oneshot::channel();
        let budget = std::time::Duration::from_millis(25);
        let (stalled, healthy, disabled) = tokio::join!(
            bounded_section(true, budget, async {
                healthy_started.await.unwrap();
                std::future::pending().await
            }),
            bounded_section(true, budget, async {
                started.send(()).unwrap();
                Ok(json!({"items":[{"id":"healthy"}]}))
            }),
            bounded_section(false, budget, async {
                panic!("Disabled sources must not run")
            }),
        );
        assert!(stalled.unwrap().is_err());
        assert_eq!(healthy.unwrap().unwrap()["items"][0]["id"], "healthy");
        assert!(disabled.is_none());
    }
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
    #[test]
    fn validates_finance_evidence_before_publishing_to_the_overlay() {
        let valid = json!({"currency":"USD","quality":"qualified","cents":1234,"reasons":["stale_evidence"]});
        assert!(finance_fact(&valid).is_ok());
        let unavailable =
            json!({"currency":"USD","quality":"unavailable","cents":null,"reasons":[]});
        assert!(finance_fact(&unavailable).is_ok());
        assert!(finance_fact(&json!({"quality":"qualified"})).is_err());
        for (key, bad) in [
            ("currency", json!("invalid")),
            ("quality", json!("unknown")),
            ("cents", json!("1234")),
            ("cents", json!(1.5)),
            ("cents", json!(9_007_199_254_740_992_i64)),
            ("reasons", Value::Null),
            ("reasons", json!([1])),
            ("reasons", json!(["private provider message"])),
            ("reasons", json!(vec!["stale_evidence"; 21])),
        ] {
            let mut broken = valid.clone();
            broken[key] = bad;
            assert!(finance_fact(&broken).is_err(), "accepted invalid {key}");
        }
        let mut missing = valid.clone();
        missing.as_object_mut().unwrap().remove("cents");
        assert!(finance_fact(&missing).is_err());
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
