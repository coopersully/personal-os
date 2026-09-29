use crate::{
    desktop::DesktopState,
    transport::{send, ApiRequest},
};
use serde_json::{json, Value};
use std::{collections::HashMap, future::Future, sync::atomic::Ordering};
use tauri::Manager;
pub(crate) async fn get(app: &tauri::AppHandle, server: &str, path: &str) -> Result<Value, String> {
    let response = send(
        app,
        ApiRequest {
            server_url: server.into(),
            path: path.into(),
            method: "GET".into(),
            body: None,
            expected_account_id: None,
        },
    )
    .await?;
    if response.status != 200 {
        return Err(format!("API returned HTTP {}", response.status));
    }
    serde_json::from_str(&response.body).map_err(|_| "Invalid API response".into())
}
pub fn daily_brief(response: &Value) -> Result<&Value, String> {
    response
        .get("brief")
        .filter(|b| b["timeZone"].is_string() && b["generatedAt"].is_string())
        .ok_or("The server returned an invalid daily brief".into())
}
fn finance_summary(response: &Value) -> Option<String> {
    let budgets = response["budgets"].as_array()?;
    if budgets.is_empty() {
        return Some("No budgets set for this month".into());
    }
    let mut currencies = std::collections::BTreeMap::<String, (f64, f64)>::new();
    for row in budgets {
        let currency = row["budget"]["currency"].as_str().unwrap_or("USD");
        let entry = currencies.entry(currency.into()).or_default();
        entry.0 += row["spent"].as_f64()?;
        entry.1 += row["remaining"].as_f64()?;
    }
    Some(
        currencies
            .iter()
            .map(|(currency, (spent, remaining))| {
                format!("{currency} {spent:.2} spent · {remaining:.2} left")
            })
            .collect::<Vec<_>>()
            .join("; "),
    )
}
async fn upcoming_reminders<F, R>(generated_at: &str, mut fetch: F) -> Result<Vec<Value>, String>
where
    F: FnMut(String) -> R,
    R: Future<Output = Result<Value, String>>,
{
    let from = chrono::DateTime::parse_from_rfc3339(generated_at)
        .map_err(|_| "Invalid daily brief timestamp")?;
    let through = from
        .checked_add_signed(chrono::Duration::days(7))
        .ok_or("Invalid reminder scheduling horizon")?;
    let mut reminders = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = std::collections::HashSet::new();
    // Bound the refresh without silently publishing a partial scheduling projection.
    for _ in 0..10 {
        let path = {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            query.append_pair("completed", "false");
            query.append_pair("dueAfter", &from.to_rfc3339());
            query.append_pair("dueBefore", &through.to_rfc3339());
            query.append_pair("limit", "100");
            if let Some(ref cursor) = cursor {
                query.append_pair("cursor", cursor);
            }
            format!("/v1/reminders?{}", query.finish())
        };
        let page = fetch(path).await?;
        reminders.extend(
            page["items"]
                .as_array()
                .ok_or("Invalid reminder response")?
                .iter()
                .cloned(),
        );
        match page.get("nextCursor") {
            Some(Value::Null) => return Ok(reminders),
            Some(Value::String(next)) if !next.is_empty() && seen.insert(next.clone()) => {
                cursor = Some(next.clone());
            }
            _ => return Err("Invalid reminder pagination cursor".into()),
        }
    }
    Err("Too many reminders in the desktop scheduling horizon".into())
}
fn calendar_account_emails(calendars: &Value, accounts: &Value) -> HashMap<String, String> {
    calendars["calendars"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|calendar| {
            let calendar_id = calendar["id"].as_str()?;
            let account_id = calendar["accountId"].as_str()?;
            let email = accounts["accounts"]
                .as_array()?
                .iter()
                .find(|account| account["id"].as_str() == Some(account_id))?["email"]
                .as_str()?
                .trim();
            (!email.is_empty()).then(|| (calendar_id.to_string(), email.to_string()))
        })
        .collect()
}
fn declined_by_calendar_account(event: &Value, emails: &HashMap<String, String>) -> bool {
    let Some(email) = event["calendarId"].as_str().and_then(|id| emails.get(id)) else {
        return false;
    };
    event["attendees"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|attendee| {
            attendee["response"] == "declined"
                && attendee["email"]
                    .as_str()
                    .is_some_and(|value| value.trim().eq_ignore_ascii_case(email))
        })
}
pub fn snapshot(
    brief: &Value,
    account_id: &str,
    server: &str,
    finance: Option<String>,
    upcoming: &[Value],
    calendar_emails: &HashMap<String, String>,
) -> Value {
    let mut reminders = Vec::<Value>::new();
    for key in ["today", "overdue"] {
        for item in brief[key].as_array().into_iter().flatten() {
            if !reminders.iter().any(|r| r["id"] == item["id"]) {
                reminders.push(item.clone());
            }
        }
    }
    for item in upcoming {
        if let Some(existing) = reminders.iter_mut().find(|r| r["id"] == item["id"]) {
            *existing = item.clone();
        } else {
            reminders.push(item.clone());
        }
    }
    let mut events = Vec::<Value>::new();
    for key in ["now", "laterToday", "allDay", "tomorrow"] {
        for item in brief[key].as_array().into_iter().flatten() {
            if !declined_by_calendar_account(item, calendar_emails)
                && !events.iter().any(|r| r["id"] == item["id"])
            {
                events.push(item.clone());
            }
        }
    }
    fn fields(items: &[Value], keys: &[&str]) -> Vec<Value> {
        items
            .iter()
            .map(|item| {
                Value::Object(
                    keys.iter()
                        .map(|key| (key.to_string(), item[*key].clone()))
                        .collect(),
                )
            })
            .collect()
    }
    let tasks = fields(
        brief["tasks"].as_array().map(Vec::as_slice).unwrap_or(&[]),
        &["id", "title", "dueAt", "status", "completedAt"],
    );
    let reminders = fields(&reminders, &["id", "title", "dueAt", "completedAt"]);
    let events = fields(
        &events,
        &[
            "id",
            "title",
            "startsAt",
            "endsAt",
            "allDay",
            "conferenceUrl",
            "calendarId",
            "status",
        ],
    );
    json!({"schemaVersion":1,"serverUrl":server,"accountId":account_id,"generatedAt":brief["generatedAt"],"timeZone":brief["timeZone"],"tasks":tasks,"reminders":reminders,"events":events,"financeSummary":finance,"stale":false})
}
pub async fn run(app: tauri::AppHandle) {
    let mut last: Option<Value> = None;
    let mut delay = 1u64;
    loop {
        let state = app.state::<DesktopState>();
        let settings = state.settings.lock().await.clone();
        let generation = state.generation.load(Ordering::SeqCst);
        let work = async {
            let me = get(&app, &settings.server_url, "/v1/me").await?;
            let account = me["user"]["id"].as_str().ok_or("Not signed in")?;
            crate::lifecycle::resume_deferred(&app).await;
            let response = get(&app, &settings.server_url, "/v1/daily-brief").await?;
            let brief = daily_brief(&response)?;
            let upcoming = if settings.notifications.enabled && settings.notifications.reminders {
                let app = &app;
                let server = &settings.server_url;
                upcoming_reminders(
                    brief["generatedAt"]
                        .as_str()
                        .ok_or("Invalid daily brief timestamp")?,
                    |path| async move { get(app, server, &path).await },
                )
                .await?
            } else {
                Vec::new()
            };
            let has_attendees = ["now", "laterToday", "allDay", "tomorrow"]
                .iter()
                .any(|key| {
                    brief[*key].as_array().into_iter().flatten().any(|event| {
                        event["attendees"]
                            .as_array()
                            .is_some_and(|attendees| !attendees.is_empty())
                    })
                });
            let calendar_emails = if has_attendees {
                let calendars = get(&app, &settings.server_url, "/v1/calendars").await?;
                let accounts = get(&app, &settings.server_url, "/v1/connectors").await?;
                calendar_account_emails(&calendars, &accounts)
            } else {
                HashMap::new()
            };
            let finance = if settings
                .pet_workspaces
                .iter()
                .chain(settings.widget_workspaces.iter())
                .any(|w| w == "finances")
            {
                match get(&app, &settings.server_url, "/v1/finances/budgets/status").await {
                    Ok(data) => finance_summary(&data),
                    Err(_) => Some("Budget status unavailable".into()),
                }
            } else {
                None
            };
            let value = snapshot(
                brief,
                account,
                &settings.server_url,
                finance,
                &upcoming,
                &calendar_emails,
            );
            let publication = state.settings.lock().await;
            if state.generation.load(Ordering::SeqCst) != generation {
                return Err("Account changed".into());
            }
            crate::native::call(&app, json!({"op":"snapshot","snapshot":value})).await?;
            last = Some(value);
            drop(publication);
            if settings.notifications.enabled && settings.notifications.mail {
                let result = poll_mail(&app, &settings.server_url, account, generation).await;
                let _transition = state.settings.lock().await;
                if state.generation.load(Ordering::SeqCst) == generation {
                    *state.mail_status.lock().await = result.err();
                }
            }
            let wallpaper_revision = crate::wallpaper::settings_revision();
            if let Err(error) =
                crate::wallpaper_schedule::refresh(&app, &settings.server_url, account, generation)
                    .await
            {
                let current_settings = state.settings.lock().await;
                if state.generation.load(Ordering::SeqCst) == generation
                    && current_settings.server_url == settings.server_url
                    && crate::wallpaper::settings_revision() == wallpaper_revision
                {
                    let mut status = state.wallpaper_status.lock().await;
                    *status = Some(error);
                }
            }
            Ok::<(), String>(())
        }
        .await;
        if work.is_err() {
            let publication = state.settings.lock().await;
            if let Some(ref mut value) = last {
                if state.account_id.lock().await.as_deref() == value["accountId"].as_str()
                    && publication.server_url == value["serverUrl"]
                    && state.generation.load(Ordering::SeqCst) == generation
                {
                    value["stale"] = json!(true);
                    let _ =
                        crate::native::call(&app, json!({"op":"snapshot","snapshot":value})).await;
                } else {
                    last = None;
                }
            }
            delay = (delay * 2).clamp(15, 300);
        } else {
            let jitter = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos() as u64
                % 11;
            delay = 60 + jitter;
        }
        tokio::select! {_=tokio::time::sleep(std::time::Duration::from_secs(delay))=>{},_=state.refresh.notified()=>{}}
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_real_api_envelope() {
        let response =
            json!({"brief":{"timeZone":"America/New_York","generatedAt":"2026-09-08T12:00:00Z"}});
        assert_eq!(
            daily_brief(&response).unwrap()["timeZone"],
            "America/New_York"
        );
        assert!(daily_brief(&response["brief"]).is_err());
        assert!(daily_brief(&json!({"brief":{}})).is_err());
    }
    #[test]
    fn finance_keeps_currencies_separate() {
        let value = json!({"budgets":[{"budget":{"currency":"USD"},"spent":15,"remaining":85},{"budget":{"currency":"EUR"},"spent":5,"remaining":20}]});
        assert_eq!(
            finance_summary(&value).unwrap(),
            "EUR 5.00 spent · 20.00 left; USD 15.00 spent · 85.00 left"
        );
    }
    #[test]
    fn merges_due_earlier_today_and_deduplicates_calendar_groups() {
        let value = snapshot(
            &json!({"today":[{"id":"a"}],"overdue":[{"id":"a"},{"id":"b"}],"now":[{"id":"event"}],"allDay":[{"id":"event"}],"tasks":[],"timeZone":"UTC","generatedAt":"2026-09-08T00:00:00Z"}),
            "user",
            "https://api.test",
            None,
            &[],
            &HashMap::new(),
        );
        assert_eq!(value["reminders"].as_array().unwrap().len(), 2);
        assert_eq!(value["events"].as_array().unwrap().len(), 1);
        assert!(value.get("sessionToken").is_none());
    }
    #[tokio::test]
    async fn schedules_tomorrows_reminders_before_midnight_and_follows_pagination() {
        let cursor = "cursor+/=&";
        let mut pages = std::collections::VecDeque::from([
            json!({"items":[{"id":"today","dueAt":"2026-09-08T23:30:00Z"}],"nextCursor":cursor}),
            json!({"items":[{"id":"tomorrow","dueAt":"2026-09-09T12:00:00Z"}],"nextCursor":null}),
        ]);
        let mut requested = Vec::new();
        let upcoming = upcoming_reminders("2026-09-08T23:00:00Z", |path| {
            requested.push(path);
            std::future::ready(Ok(pages.pop_front().unwrap()))
        })
        .await
        .unwrap();
        assert_eq!(requested.len(), 2);
        for path in &requested {
            let url = url::Url::parse(&format!("https://api.test{path}")).unwrap();
            assert_eq!(url.path(), "/v1/reminders");
            let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
            assert_eq!(query["completed"], "false");
            assert_eq!(query["limit"], "100");
            assert_eq!(query["dueAfter"], "2026-09-08T23:00:00+00:00");
            assert_eq!(query["dueBefore"], "2026-09-15T23:00:00+00:00");
        }
        assert!(requested[1].contains("cursor=cursor%2B%2F%3D%26"));
        let value = snapshot(
            &json!({"today":[{"id":"today","dueAt":"2026-09-08T23:00:00Z"}],"overdue":[{"id":"older"}],"timeZone":"America/New_York","generatedAt":"2026-09-08T23:00:00Z"}),
            "user",
            "https://api.test",
            None,
            &upcoming,
            &HashMap::new(),
        );
        let reminders = value["reminders"].as_array().unwrap();
        assert_eq!(reminders.len(), 3);
        assert_eq!(reminders[0]["dueAt"], "2026-09-08T23:30:00Z");
        assert!(reminders.iter().any(|item| item["id"] == "tomorrow"));
    }
    #[tokio::test]
    async fn refuses_partial_or_nonprogressing_reminder_pages() {
        let malformed = upcoming_reminders("2026-09-08T23:00:00Z", |_| {
            std::future::ready(Ok(json!({"items":[],"nextCursor":42})))
        })
        .await;
        assert!(malformed.is_err());
        let mut count = 0;
        let repeated = upcoming_reminders("2026-09-08T23:00:00Z", |_| {
            count += 1;
            std::future::ready(Ok(json!({"items":[],"nextCursor":"same"})))
        })
        .await;
        assert!(repeated.is_err());
        assert_eq!(count, 2);
        let failed = upcoming_reminders("2026-09-08T23:00:00Z", |_| {
            std::future::ready(Err("offline".into()))
        })
        .await;
        assert_eq!(failed.unwrap_err(), "offline");
        let invalid_time = upcoming_reminders("invalid", |_| {
            panic!("Invalid dates must not start a request");
            #[allow(unreachable_code)]
            std::future::ready(Ok(Value::Null))
        })
        .await;
        assert!(invalid_time.is_err());
    }
    #[test]
    fn declines_require_the_events_calendar_account_identity() {
        let emails = calendar_account_emails(
            &json!({"calendars":[{"id":"work","accountId":"work-account"},{"id":"personal","accountId":"personal-account"},{"id":"unknown","accountId":"missing"}]}),
            &json!({"accounts":[{"id":"work-account","email":"Work@Example.com"},{"id":"personal-account","email":"personal@example.com"}]}),
        );
        let declined = json!({"id":"declined","calendarId":"work","status":"confirmed","attendees":[{"email":"work@example.com","response":"declined"}]});
        let other_declined = json!({"id":"other","calendarId":"personal","status":"confirmed","attendees":[{"email":"work@example.com","response":"declined"},{"email":"personal@example.com","response":"accepted"}]});
        let unknown = json!({"id":"unknown","calendarId":"unknown","status":"confirmed","attendees":[{"email":"work@example.com","response":"declined"}]});
        assert!(declined_by_calendar_account(&declined, &emails));
        assert!(!declined_by_calendar_account(&other_declined, &emails));
        assert!(!declined_by_calendar_account(&unknown, &emails));
        assert!(!declined_by_calendar_account(
            &json!({"calendarId":"work"}),
            &emails
        ));
        let value = snapshot(
            &json!({"now":[declined,other_declined,unknown],"timeZone":"UTC","generatedAt":"2026-09-08T23:00:00Z"}),
            "user",
            "https://api.test",
            None,
            &[],
            &emails,
        );
        let events = value["events"].as_array().unwrap();
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|event| event["status"] == "confirmed"));
        assert!(events.iter().all(|event| event.get("attendees").is_none()));
    }
}

async fn poll_mail(
    app: &tauri::AppHandle,
    server: &str,
    user: &str,
    generation: u64,
) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    use std::hash::{Hash, Hasher};
    let mut identity_hash = std::collections::hash_map::DefaultHasher::new();
    (server, user).hash(&mut identity_hash);
    let path = directory.join(format!("mail-cursor-{:016x}.json", identity_hash.finish()));
    let stored = std::fs::read(&path)
        .ok()
        .and_then(|data| serde_json::from_slice::<Value>(&data).ok());
    let cursor = stored
        .as_ref()
        .filter(|s| s["serverUrl"] == server && s["userId"] == user)
        .and_then(|s| s["cursor"].as_str())
        .filter(|c| c.bytes().all(|b| b.is_ascii_digit()));
    let endpoint = cursor
        .map(|c| format!("/v1/desktop/activity?cursor={c}"))
        .unwrap_or("/v1/desktop/activity".into());
    let page = get(app, server, &endpoint).await?;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Err("Account changed".into());
    }
    let mut catchup_accounts = std::collections::HashSet::new();
    for event in page["events"].as_array().into_iter().flatten() {
        let age = event["receivedAt"]
            .as_str()
            .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
            .map(|d| chrono::Utc::now().signed_duration_since(d).num_seconds());
        if age.is_some_and(|seconds| seconds >= 900) {
            if let Some(account) = event["accountId"].as_str() {
                catchup_accounts.insert(account.to_string());
            }
            continue;
        }
        if !age.is_some_and(|seconds| (0..900).contains(&seconds)) {
            continue;
        }
        if state.generation.load(Ordering::SeqCst) != generation {
            return Err("Account changed".into());
        }
        let _publication = state.settings.lock().await;
        if state.generation.load(Ordering::SeqCst) != generation {
            return Err("Account changed".into());
        }
        crate::native::call(app,json!({"op":"mail","id":event["id"],"accountId":event["accountId"],"userId":user,"serverUrl":server,"title":event["subject"],"body":event["sender"],"path":format!("/mail?thread={}",event["threadId"].as_str().unwrap_or(""))})).await?;
    }
    // One private catch-up per mailbox/day, even when the replay spans many feed pages.
    for account in catchup_accounts {
        let _transition = state.settings.lock().await;
        if state.generation.load(Ordering::SeqCst) != generation {
            return Err("Account changed".into());
        }
        crate::native::call(app,json!({"op":"mail","id":format!("catchup:{account}:{}",chrono::Local::now().format("%Y-%m-%d")),"accountId":account,"userId":user,"serverUrl":server,"title":"Mail arrived while you were away","path":"/mail"})).await?;
    }
    let next = page["cursor"]
        .as_str()
        .filter(|c| !c.is_empty() && c.bytes().all(|b| b.is_ascii_digit()))
        .ok_or("Invalid mail feed cursor")?;
    let _lock = state.settings.lock().await;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Err("Account changed".into());
    }
    let temporary = path.with_extension("tmp");
    std::fs::write(
        &temporary,
        json!({"serverUrl":server,"userId":user,"cursor":next}).to_string(),
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temporary, path).map_err(|e| e.to_string())?;
    if page["hasMore"] == true {
        state.refresh.notify_one();
    }
    Ok(())
}
