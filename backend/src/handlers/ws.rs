use crate::models::JobUpdate;
use crate::state::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};

/// WebSocket 客戶端發送的訊息類型
///
/// `rename_all = "snake_case"`：與 JSON 面上其餘部分（欄位名、`JobStatus`）一致。
#[derive(Debug, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum WsClientMessage {
    /// 訂閱 Docker 容器統計
    SubscribeDockerStats { container_id: String },
    /// 取消訂閱 Docker 容器統計
    UnsubscribeDockerStats { container_id: String },
    /// Ping (保持連線)
    Ping,
}

/// WebSocket 伺服器發送的訊息類型。
///
/// ⚠️ **這是伺服器送出的唯一信封** —— 每一則訊息都必須是本 enum 的某個 variant。
/// 先前 `JobUpdate` 是直接把裸物件序列化丟上同一條 socket（沒有 `type` 欄位），
/// 於是前端的 `switch (msg.type)` 拿到 `undefined`，背景工作的進度與完成通知
/// 從來沒有送達過。要加新的推播就在這裡加 variant，不要另闢管道。
#[derive(Debug, Clone, Serialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum WsServerMessage {
    /// 背景工作進度更新（來源是 `utils::queue` 的 broadcast）
    JobUpdate(JobUpdate),
    /// Docker 容器統計數據
    DockerStats {
        container_id: String,
        cpu_percent: f64,
        #[specta(type = specta_typescript::Number)]
        memory_usage: u64,
        #[specta(type = specta_typescript::Number)]
        memory_limit: u64,
        memory_percent: f64,
        #[specta(type = specta_typescript::Number)]
        network_rx: u64,
        #[specta(type = specta_typescript::Number)]
        network_tx: u64,
        #[specta(type = specta_typescript::Number)]
        block_read: u64,
        #[specta(type = specta_typescript::Number)]
        block_write: u64,
        #[specta(type = specta_typescript::Number)]
        timestamp: i64,
    },
    /// Docker 統計錯誤
    DockerStatsError { container_id: String, error: String },
    /// Pong 回應
    Pong,
    /// 錯誤訊息
    Error { message: String },
}

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    // 追蹤訂閱的 Docker 容器
    let docker_subscriptions = std::sync::Arc::new(tokio::sync::RwLock::new(std::collections::HashSet::<
        String,
    >::new()));

    // Docker 統計推送任務句柄
    let docker_tasks = std::sync::Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::<
        String,
        tokio::task::JoinHandle<()>,
    >::new()));

    // 創建一個 channel 來傳送 WebSocket 訊息
    let (ws_tx, mut ws_rx) = tokio::sync::mpsc::channel::<WsServerMessage>(100);

    // Spawn a task to forward broadcast messages to this websocket
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                // 處理 Job 更新廣播（包進統一信封後才送，見 WsServerMessage 的說明）
                result = rx.recv() => {
                    match result {
                        Ok(job) => {
                            let msg = WsServerMessage::JobUpdate(job);
                            if let Ok(json) = serde_json::to_string(&msg) {
                                if sender.send(Message::Text(json.into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                // 處理 Docker 統計訊息
                Some(msg) = ws_rx.recv() => {
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if sender.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    });

    let docker_subscriptions_clone = docker_subscriptions.clone();
    let docker_tasks_clone = docker_tasks.clone();
    let state_clone = state.clone();
    let ws_tx_clone = ws_tx.clone();

    // Spawn a task to handle incoming messages
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    // 解析客戶端訊息
                    if let Ok(client_msg) = serde_json::from_str::<WsClientMessage>(&text) {
                        match client_msg {
                            WsClientMessage::SubscribeDockerStats { container_id } => {
                                // 檢查 Docker 服務是否可用
                                if let Some(docker_service) = &state_clone.docker_service {
                                    let mut subs = docker_subscriptions_clone.write().await;
                                    if !subs.contains(&container_id) {
                                        subs.insert(container_id.clone());
                                        drop(subs);

                                        // 啟動 Docker 統計推送任務
                                        let docker = docker_service.clone();
                                        let container_id_clone = container_id.clone();
                                        let tx = ws_tx_clone.clone();

                                        let task = tokio::spawn(async move {
                                            loop {
                                                match docker.container_stats(&container_id_clone).await {
                                                    Ok(stats) => {
                                                        let msg = WsServerMessage::DockerStats {
                                                            container_id: container_id_clone.clone(),
                                                            cpu_percent: stats.cpu_percent,
                                                            memory_usage: stats.memory_usage,
                                                            memory_limit: stats.memory_limit,
                                                            memory_percent: stats.memory_percent,
                                                            network_rx: stats.network_rx,
                                                            network_tx: stats.network_tx,
                                                            block_read: stats.block_read,
                                                            block_write: stats.block_write,
                                                            timestamp: chrono::Utc::now().timestamp(),
                                                        };
                                                        if tx.send(msg).await.is_err() {
                                                            break;
                                                        }
                                                    }
                                                    Err(e) => {
                                                        let msg = WsServerMessage::DockerStatsError {
                                                            container_id: container_id_clone.clone(),
                                                            error: e.to_string(),
                                                        };
                                                        let _ = tx.send(msg).await;
                                                        // 發生錯誤時等待較長時間再重試
                                                        tokio::time::sleep(tokio::time::Duration::from_secs(
                                                            5,
                                                        ))
                                                        .await;
                                                        continue;
                                                    }
                                                }
                                                // 每秒更新一次
                                                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                                            }
                                        });

                                        let mut tasks = docker_tasks_clone.write().await;
                                        tasks.insert(container_id, task);
                                    }
                                } else {
                                    let _ = ws_tx_clone
                                        .send(WsServerMessage::Error {
                                            message: "Docker service is not enabled".to_string(),
                                        })
                                        .await;
                                }
                            }
                            WsClientMessage::UnsubscribeDockerStats { container_id } => {
                                let mut subs = docker_subscriptions_clone.write().await;
                                subs.remove(&container_id);
                                drop(subs);

                                // 取消對應的推送任務
                                let mut tasks = docker_tasks_clone.write().await;
                                if let Some(task) = tasks.remove(&container_id) {
                                    task.abort();
                                }
                            }
                            WsClientMessage::Ping => {
                                let _ = ws_tx_clone.send(WsServerMessage::Pong).await;
                            }
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }

        // 清理所有 Docker 任務
        let tasks = docker_tasks_clone.read().await;
        for task in tasks.values() {
            task.abort();
        }
    });

    // If any one of the tasks exit, abort the other
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };
}
