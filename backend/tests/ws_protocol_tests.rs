//! WebSocket 線上格式的定樁測試。
//!
//! 為什麼值得釘住：這個協定曾經**整條都是壞的，而且完全沒有症狀**。
//! 後端把 `JobUpdate` 裸序列化丟上 socket（沒有 `type` 欄位），
//! 而 `WsServerMessage` 用的是 `PascalCase` 的 variant 名；前端則在比對
//! `'job_update'` / `'docker_stats'`。三者互不相符，於是背景工作的
//! 進度與完成通知從來沒有送達過 —— 沒有錯誤、沒有 log，只是安靜地什麼都不發生。
//!
//! 型別層面現在由 specta 擔保（前端直接用產生的 `WsServerMessage`），
//! 但 `#[serde(rename_all)]` 或 `content` 鍵被改掉的話型別檢查是抓不到的
//! ——那會同時改動兩邊的產物，看起來依然「一致」，卻與舊客戶端不相容。
//! 這幾條測試把實際的 JSON 字面釘死。

use Koimsurai_NAS::handlers::ws::{WsClientMessage, WsServerMessage};
use Koimsurai_NAS::models::{JobStatus, JobUpdate};

#[test]
fn job_update_is_wrapped_in_the_envelope() {
    let msg = WsServerMessage::JobUpdate(JobUpdate {
        job_id: "job-1".into(),
        status: JobStatus::Completed,
        progress: 100,
        error: None,
    });

    let v: serde_json::Value = serde_json::to_value(&msg).unwrap();

    assert_eq!(v["type"], "job_update", "variant tag 必須是 snake_case");
    assert_eq!(v["payload"]["job_id"], "job-1");
    assert_eq!(v["payload"]["status"], "completed");
    assert_eq!(v["payload"]["progress"], 100);
    // 曾經的 bug：payload 被攤平到頂層、連 type 都沒有
    assert!(v.get("job_id").is_none(), "payload 不可攤平到頂層");
}

#[test]
fn unit_variant_has_no_payload_key() {
    let v = serde_json::to_value(WsServerMessage::Pong).unwrap();
    assert_eq!(v["type"], "pong");
    assert!(v.get("payload").is_none());
}

#[test]
fn server_variant_tags_are_snake_case() {
    let v = serde_json::to_value(WsServerMessage::Error {
        message: "boom".into(),
    })
    .unwrap();
    assert_eq!(v["type"], "error");

    let v = serde_json::to_value(WsServerMessage::DockerStatsError {
        container_id: "abc".into(),
        error: "nope".into(),
    })
    .unwrap();
    assert_eq!(v["type"], "docker_stats_error");
}

#[test]
fn client_messages_parse_from_the_documented_shape() {
    let msg: WsClientMessage = serde_json::from_str(
        r#"{"type":"subscribe_docker_stats","payload":{"container_id":"abc"}}"#,
    )
    .expect("前端送的形狀必須解析得出來");
    match msg {
        WsClientMessage::SubscribeDockerStats { container_id } => assert_eq!(container_id, "abc"),
        other => panic!("解析成了錯的 variant: {other:?}"),
    }

    let ping: WsClientMessage = serde_json::from_str(r#"{"type":"ping"}"#).unwrap();
    assert!(matches!(ping, WsClientMessage::Ping));
}
