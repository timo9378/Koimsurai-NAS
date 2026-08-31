use crate::error::AppError;
use crate::services::indexer::Indexer;
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::process::Command;
use sysinfo::{Components, Disks, ProcessesToUpdate, System, MINIMUM_CPU_UPDATE_INTERVAL};

#[derive(Serialize, utoipa::ToSchema, specta::Type)]
pub struct SystemStatus {
    cpu_usage: f32,
    cpu_temp: Option<f32>,
    #[specta(type = specta_typescript::Number)]
    total_memory: u64,
    #[specta(type = specta_typescript::Number)]
    used_memory: u64,
    #[specta(type = specta_typescript::Number)]
    total_swap: u64,
    #[specta(type = specta_typescript::Number)]
    used_swap: u64,
    disks: Vec<DiskInfo>,
    gpu: Option<GpuInfo>,
    top_processes: Vec<ProcessInfo>,
    ups: Option<UpsInfo>,
}

#[derive(Serialize, utoipa::ToSchema, specta::Type)]
pub struct ProcessInfo {
    pid: u32,
    name: String,
    cpu_usage: f32,
    #[specta(type = specta_typescript::Number)]
    memory_bytes: u64,
    memory_percent: f32,
}

#[derive(Serialize, utoipa::ToSchema, specta::Type)]
pub struct DiskInfo {
    name: String,
    mount_point: String,
    #[specta(type = specta_typescript::Number)]
    total_space: u64,
    #[specta(type = specta_typescript::Number)]
    available_space: u64,
    disk_type: String,
}

#[derive(Serialize, Clone, utoipa::ToSchema, specta::Type)]
pub struct GpuInfo {
    name: String,
    #[specta(type = specta_typescript::Number)]
    memory_total: u64,
    #[specta(type = specta_typescript::Number)]
    memory_used: u64,
    #[specta(type = specta_typescript::Number)]
    memory_free: u64,
    utilization: f32,
    temperature: u32,
}

fn get_gpu_info() -> Option<GpuInfo> {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.trim();
    let parts: Vec<&str> = line.split(", ").collect();

    if parts.len() >= 6 {
        Some(GpuInfo {
            name: parts[0].trim().to_string(),
            memory_total: parts[1].trim().parse().unwrap_or(0) * 1024 * 1024, // MiB to bytes
            memory_used: parts[2].trim().parse().unwrap_or(0) * 1024 * 1024,
            memory_free: parts[3].trim().parse().unwrap_or(0) * 1024 * 1024,
            utilization: parts[4].trim().parse().unwrap_or(0.0),
            temperature: parts[5].trim().parse().unwrap_or(0),
        })
    } else {
        None
    }
}

#[derive(Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
pub struct UpsInfo {
    /// NUT ups.status，例如 "OL"（吃市電）/ "OB"（吃電池）/ "OL CHRG"
    status: String,
    /// 是否正常吃市電（OL 且非 OB）
    online: bool,
    /// 電池電量 %
    battery_charge: Option<f32>,
    /// 剩餘可用秒數
    #[specta(type = Option<specta_typescript::Number>)]
    battery_runtime: Option<u64>,
    /// UPS 負載 %
    ups_load: Option<f32>,
    /// 輸入（市電）電壓
    input_voltage: Option<f32>,
    /// 輸出電壓
    output_voltage: Option<f32>,
    /// 機型
    model: Option<String>,
    /// 這份資料的時間戳（host 端寫入時間）
    updated_at: Option<String>,
}

/// 從 host 端寫入的 /data/ups.json 讀 UPS 狀態（由 ups-log.sh 每分鐘更新）
fn get_ups_info() -> Option<UpsInfo> {
    let raw = std::fs::read_to_string("/data/ups.json").ok()?;
    serde_json::from_str::<UpsInfo>(&raw).ok()
}

fn get_cpu_temperature() -> Option<f32> {
    let components = Components::new_with_refreshed_list();

    // Look for CPU temperature sensors
    // Common sensor names: "coretemp", "k10temp", "cpu_thermal", "Package", "Core"
    for component in &components {
        let label = component.label().to_lowercase();
        if label.contains("core")
            || label.contains("cpu")
            || label.contains("package")
            || label.contains("tctl")
        {
            // temperature() returns Option<f32>
            if let Some(temp) = component.temperature() {
                return Some(temp);
            }
        }
    }

    // Fallback: return first component temperature if available
    components.iter().next().and_then(sysinfo::Component::temperature)
}

/// Get top processes (by real, delta-based CPU%) from the shared `System` snapshot.
// 百分比顯示：u64 位元組轉浮點必然有損，而這正是要的 —— 顯示到小數點後一位，
// 而 u64 的位元組數在 f32/f64 的尾數範圍內綽綽有餘（f64 可精確表示到 2^53 位元組 = 9 PB）。
#[allow(
    clippy::cast_precision_loss,
    reason = "百分比顯示，位元組數遠低於浮點尾數上限"
)]
fn get_top_processes(sys: &System, total_memory: u64) -> Vec<ProcessInfo> {
    // Read CPU% straight from the shared `System` snapshot. Because
    // get_system_status refreshes it twice MINIMUM_CPU_UPDATE_INTERVAL apart,
    // each process cpu_usage() is a real delta — a just-spawned short-lived
    // process reads ~0%, not the bogus hundreds-of-percent that `ps`'s
    // lifetime-average %cpu column used to report.
    let mut processes: Vec<ProcessInfo> = sys
        .processes()
        .iter()
        .map(|(pid, process)| {
            let memory_bytes = process.memory(); // sysinfo 0.33 reports bytes
            let memory_percent = if total_memory > 0 {
                (memory_bytes as f32 / total_memory as f32) * 100.0
            } else {
                0.0
            };
            ProcessInfo {
                pid: pid.as_u32(),
                name: process.name().to_string_lossy().to_string(),
                // %/core; can exceed 100 for genuinely multi-core processes
                cpu_usage: process.cpu_usage(),
                memory_bytes,
                memory_percent,
            }
        })
        .collect();
    processes.sort_by(|a, b| {
        b.cpu_usage
            .partial_cmp(&a.cpu_usage)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Filter out noise (very low usage processes that aren't interesting)
    processes.retain(|p| p.cpu_usage >= 0.1 || p.memory_bytes > 50 * 1024 * 1024);
    processes.truncate(15);
    processes
}

#[utoipa::path(
    get,
    path = "/api/system/status",
    responses(
        (status = 200, description = "System status", body = SystemStatus)
    )
)]
pub async fn get_system_status() -> Json<SystemStatus> {
    // sysinfo derives CPU% from the delta between two refreshes, so we must
    // sample twice at least MINIMUM_CPU_UPDATE_INTERVAL apart. The previous
    // new_all() + refresh_all() measured over a ~0s window and produced
    // unstable readings that spiked to 50-60% while the box was actually idle.
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    tokio::time::sleep(MINIMUM_CPU_UPDATE_INTERVAL).await;
    sys.refresh_cpu_usage();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.refresh_memory();

    let cpu_usage = sys.global_cpu_usage();
    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();
    let total_swap = sys.total_swap();
    let used_swap = sys.used_swap();

    let disks = Disks::new_with_refreshed_list();

    // Filter out overlay, loop, tmpfs, Docker mounts, and virtual filesystems
    // Only show real physical disks with actual mount points
    let disk_info: Vec<DiskInfo> = disks
        .list()
        .iter()
        .filter(|disk| {
            let mount = disk.mount_point().to_string_lossy();
            let name = disk.name().to_string_lossy();

            // Skip loop devices
            if name.starts_with("loop") {
                return false;
            }

            // Skip various virtual/system mounts
            if mount.contains("/snap/")
                || mount.starts_with("/boot")
                || mount.starts_with("/run")
                || mount == "/dev/shm"
            {
                return false;
            }

            // Skip Docker-related mounts (overlay, container config files)
            // These typically have overlay name or short config file mounts
            if name == "overlay" || name.is_empty() {
                return false;
            }

            // Skip Docker container config files (resolv.conf, hostname, hosts, etc.)
            let mount_str = mount.to_string();
            if mount_str.contains("/docker/")
                || mount_str.ends_with("/resolv.conf")
                || mount_str.ends_with("/hostname")
                || mount_str.ends_with("/hosts")
                || mount_str.ends_with("/db")
            {
                return false;
            }

            // Skip NVIDIA driver mounts and system library directories
            // These are bind-mounted by nvidia-container-toolkit
            if mount_str.starts_with("/usr/")
                || mount_str.starts_with("/lib/")
                || mount_str.starts_with("/lib64/")
                || mount_str.contains("nvidia")
                || mount_str.contains("libnvidia")
                || mount_str.contains("gsp_")
                || name.contains("nvidia")
                || name.starts_with("libnvidia")
                || name.starts_with("gsp_")
            {
                return false;
            }

            // Only include if it's a real disk with substantial size (at least 1GB)
            disk.total_space() > 1024 * 1024 * 1024
        })
        .map(|disk| {
            let name = disk.name().to_string_lossy().to_string();
            let mount = disk.mount_point().to_string_lossy().to_string();

            // Determine disk type based on name
            let disk_type = if name.contains("nvme") {
                "NVMe SSD".to_string()
            } else if name.contains("sd") {
                "HDD".to_string()
            } else {
                "Unknown".to_string()
            };

            DiskInfo {
                name,
                mount_point: mount,
                total_space: disk.total_space(),
                available_space: disk.available_space(),
                disk_type,
            }
        })
        .collect();

    // Get GPU info
    let gpu = get_gpu_info();

    // Get CPU temperature
    let cpu_temp = get_cpu_temperature();

    // Get top processes using ps command (works in container)
    let top_processes = get_top_processes(&sys, total_memory);

    // Get UPS status from host-written /data/ups.json (updated by ups-log.sh)
    let ups = get_ups_info();

    Json(SystemStatus {
        cpu_usage,
        cpu_temp,
        total_memory,
        used_memory,
        total_swap,
        used_swap,
        disks: disk_info,
        gpu,
        top_processes,
        ups,
    })
}

/// 一致性檢查結果
#[derive(Serialize, utoipa::ToSchema, specta::Type)]
pub struct ConsistencyCheckResult {
    #[specta(type = specta_typescript::Number)]
    pub total_db_entries: usize,
    #[specta(type = specta_typescript::Number)]
    pub removed_orphans: usize,
    pub message: String,
}

/// 觸發資料庫與檔案系統的一致性檢查
/// 這會移除 DB 中存在但磁碟上不存在的檔案記錄
/// 適合在 Litestream 還原 DB 後執行
#[utoipa::path(
    post,
    path = "/api/system/verify-consistency",
    responses(
        (status = 200, description = "Consistency check completed", body = ConsistencyCheckResult),
        (status = 409, description = "已經有一個維護作業在跑")
    )
)]
pub async fn verify_consistency(
    State(state): State<AppState>,
) -> Result<Json<ConsistencyCheckResult>, AppError> {
    // 見 AppState::maintenance_lock 的說明：已經在跑就拒絕，不排隊。
    let Ok(_guard) = state.maintenance_lock.try_lock() else {
        return Err(AppError::Status(StatusCode::CONFLICT));
    };
    let indexer = Indexer::new(state.pool.clone(), state.storage_path.as_path().to_path_buf());

    Ok(match indexer.verify_consistency().await {
        Ok((total, removed)) => Json(ConsistencyCheckResult {
            total_db_entries: total,
            removed_orphans: removed,
            message: format!(
                "Consistency check complete. Checked {total} entries, removed {removed} orphaned records."
            ),
        }),
        Err(e) => Json(ConsistencyCheckResult {
            total_db_entries: 0,
            removed_orphans: 0,
            message: format!("Consistency check failed: {e}"),
        }),
    })
}

/// 重新掃描結果
#[derive(Serialize, utoipa::ToSchema, specta::Type)]
pub struct RescanResult {
    pub success: bool,
    pub message: String,
}

/// 觸發完整的檔案系統重新掃描
/// 這會同步磁碟狀態到資料庫，包括添加新檔案和移除已刪除的記錄
#[utoipa::path(
    post,
    path = "/api/system/rescan",
    responses(
        (status = 200, description = "Rescan completed", body = RescanResult),
        (status = 409, description = "已經有一個維護作業在跑")
    )
)]
pub async fn trigger_rescan(State(state): State<AppState>) -> Result<Json<RescanResult>, AppError> {
    let Ok(_guard) = state.maintenance_lock.try_lock() else {
        return Err(AppError::Status(StatusCode::CONFLICT));
    };
    let indexer = Indexer::new(state.pool.clone(), state.storage_path.as_path().to_path_buf());

    Ok(match indexer.full_scan().await {
        Ok(()) => Json(RescanResult {
            success: true,
            message: "Full rescan completed successfully.".to_string(),
        }),
        Err(e) => Json(RescanResult {
            success: false,
            message: format!("Rescan failed: {e}"),
        }),
    })
}
