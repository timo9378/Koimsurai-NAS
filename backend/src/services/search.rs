use crate::error::AppError;
use axum::http::StatusCode;
use sqlx::{Pool, Sqlite};
use std::env;
use std::path::Path;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, Schema, Term, STORED, STRING, TEXT};
use tantivy::schema::{TantivyDocument, Value};
use tantivy::{doc, Index, IndexWriter, ReloadPolicy};
use tracing::{debug, info};

/// 批次提交配置 - 從環境變數讀取
/// Batch commit configuration - read from env
fn get_batch_size() -> usize {
    env::var("SEARCH_BATCH_SIZE")
        .unwrap_or_else(|_| "100".to_string())
        .parse()
        .unwrap_or(100)
}

fn get_commit_interval_secs() -> u64 {
    env::var("SEARCH_COMMIT_INTERVAL_SECS")
        .unwrap_or_else(|_| "5".to_string())
        .parse()
        .unwrap_or(5)
}

pub struct SearchService {
    index: Index,
    writer: Arc<Mutex<IndexWriter>>,
    /// schema 的欄位 handle。⚠️ 建構時抓好，不要在使用處 `get_field("path").unwrap()`
    /// —— 那是把「欄位必然存在」這件建構時就決定好的事，變成每次呼叫的 panic 風險。
    path_field: Field,
    name_field: Field,
    content_field: Field,
    /// 追蹤待 commit 的文件數量
    pending_count: AtomicUsize,
    /// 上次 commit 的時間
    last_commit: Arc<Mutex<Instant>>,
    /// 批次大小
    batch_size: usize,
    /// commit 間隔 (秒)
    commit_interval: Duration,
}

impl SearchService {
    pub fn new(storage_path: &Path) -> Result<Self, AppError> {
        let index_path = storage_path.join(".search_index");
        if !index_path.exists() {
            std::fs::create_dir_all(&index_path).map_err(AppError::from)?;
        }

        let mut schema_builder = Schema::builder();
        // add_text_field 會回傳 Field，直接留住就不必事後用字串查回來。
        let path_field = schema_builder.add_text_field("path", STRING | STORED);
        let content_field = schema_builder.add_text_field("content", TEXT);
        let name_field = schema_builder.add_text_field("name", TEXT | STORED);
        let schema = schema_builder.build();

        let index = Index::open_or_create(
            tantivy::directory::MmapDirectory::open(&index_path)
                .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?,
            schema,
        )
        .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;

        // 從環境變數讀取搜尋索引緩衝區大小 (MB)
        // Read search index buffer size from env (MB)
        // 開發機: 50MB, Server: 500MB+
        let buffer_size_mb = env::var("SEARCH_INDEX_BUFFER_MB")
            .unwrap_or_else(|_| "50".to_string())
            .parse::<usize>()
            .unwrap_or(50);

        let buffer_size = buffer_size_mb * 1_000_000;
        info!("Search index buffer size: {}MB", buffer_size_mb);

        let writer = index
            .writer(buffer_size)
            .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;

        let batch_size = get_batch_size();
        let commit_interval = Duration::from_secs(get_commit_interval_secs());

        info!(
            "Search batch_size: {}, commit_interval: {:?}",
            batch_size, commit_interval
        );

        Ok(Self {
            index,
            writer: Arc::new(Mutex::new(writer)),
            path_field,
            name_field,
            content_field,
            pending_count: AtomicUsize::new(0),
            last_commit: Arc::new(Mutex::new(Instant::now())),
            batch_size,
            commit_interval,
        })
    }

    /// 索引單一檔案 (不立即 commit，使用批次策略)
    /// Index a single file (doesn't commit immediately, uses batch strategy)
    pub fn index_file(&self, path: &str, name: &str, content: &str) -> Result<(), AppError> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;

        let (path_field, name_field, content_field) = (self.path_field, self.name_field, self.content_field);

        // Remove existing document with same path to avoid duplicates (simple update strategy)
        let term = Term::from_field_text(path_field, path);
        writer.delete_term(term);

        let doc = doc!(
            path_field => path,
            name_field => name,
            content_field => content
        );

        writer
            .add_document(doc)
            .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;

        // 增加待處理計數
        let pending = self.pending_count.fetch_add(1, Ordering::SeqCst) + 1;

        // 檢查是否需要 commit
        let should_commit = {
            let last_commit = self
                .last_commit
                .lock()
                .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
            pending >= self.batch_size || last_commit.elapsed() >= self.commit_interval
        };

        if should_commit {
            debug!("Batch committing {} indexed files", pending);
            writer
                .commit()
                .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;
            // ⚠️ 先放掉 writer 再去拿 last_commit。這兩把鎖原本是巢狀持有的
            // （writer → last_commit）；flush() 用同樣順序所以不會死鎖，但沒有理由
            // 讓 writer 在只是寫個時間戳的時候還被佔著 —— 索引寫入是全域序列化的。
            drop(writer);
            self.pending_count.store(0, Ordering::SeqCst);
            *self
                .last_commit
                .lock()
                .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))? = Instant::now();
        }

        Ok(())
    }

    /// 強制 commit 所有待處理的索引變更
    /// Force commit all pending index changes
    pub fn flush(&self) -> Result<(), AppError> {
        let pending = self.pending_count.load(Ordering::SeqCst);
        if pending > 0 {
            info!("Flushing {} pending index entries", pending);
            let mut writer = self
                .writer
                .lock()
                .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
            writer
                .commit()
                .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;
            drop(writer); // 同 index_file：不要持著 writer 去拿 last_commit
            self.pending_count.store(0, Ordering::SeqCst);
            *self
                .last_commit
                .lock()
                .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))? = Instant::now();
        }
        Ok(())
    }

    pub fn search(&self, query_str: &str) -> Result<Vec<SearchResult>, AppError> {
        // 搜尋前先 flush 確保結果最新 (可選)
        // Optionally flush before search to ensure up-to-date results
        // self.flush()?;

        let reader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay) // 改用 OnCommitWithDelay 來自動更新
            .try_into()
            .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;

        let searcher = reader.searcher();

        let (path_field, name_field, content_field) = (self.path_field, self.name_field, self.content_field);

        let query_parser = QueryParser::for_index(&self.index, vec![name_field, content_field]);

        // ⚠️ 用 lenient 版本，不要用 `parse_query`。
        //
        // tantivy 把輸入當成**查詢語言**解析（`"`、`(`、`)`、`+`、`-`、`AND`…
        // 都是運算子）。使用者在搜尋框裡打一個引號或括號就會 parse 失敗，
        // 原本的處置是往上丟成 500，而且錯誤訊息會原封不動回給客戶端：
        //
        //     GET /api/search?q=Ð}(  →  500 {"error":"Syntax Error: Ð}("}
        //
        // 兩個問題：使用者正常的輸入不該回 500，而且不該把解析器的內部訊息
        // 送出去。lenient 版會盡量解析、把錯誤收集起來而不是失敗。
        // （schemathesis 找到的。）
        let (query, parse_errors) = query_parser.parse_query_lenient(query_str);
        if !parse_errors.is_empty() {
            tracing::debug!(?parse_errors, query_str, "搜尋語法有問題，已盡量解析");
        }

        let top_docs: Vec<(f32, tantivy::DocAddress)> = searcher
            .search(&query, &TopDocs::with_limit(20))
            .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;

        let mut results = Vec::new();
        for (score, doc_address) in top_docs {
            let retrieved_doc: TantivyDocument = searcher
                .doc(doc_address)
                .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;

            let path = retrieved_doc
                .get_first(path_field)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let name = retrieved_doc
                .get_first(name_field)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            results.push(SearchResult { path, name, score });
        }

        Ok(results)
    }
}

#[derive(serde::Serialize, utoipa::ToSchema, specta::Type)]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub score: f32,
}

/// AI 標籤搜尋結果
#[derive(serde::Serialize, utoipa::ToSchema, specta::Type)]
pub struct AiTagSearchResult {
    pub path: String,
    pub name: String,
    pub tag: String,
    pub confidence: f32,
}

/// 在資料庫中搜尋含有指定 AI 標籤的圖片
/// Search images containing specified AI tag in database
// confidence 存進 DB 是 REAL（f64），而 DTO 用 f32 —— 這是刻意的窄化：
// 信心值域是 0..1，f32 的 ~7 位有效數字遠超過需要的精度。
#[allow(
    clippy::cast_possible_truncation,
    reason = "confidence 值域 0..1，f32 精度綽綽有餘"
)]
pub async fn search_by_ai_tag(
    pool: &Pool<Sqlite>,
    tag_query: &str,
    min_confidence: Option<f32>,
    limit: Option<i32>,
) -> Result<Vec<AiTagSearchResult>, AppError> {
    let min_conf = min_confidence.unwrap_or(0.3);
    let limit = limit.unwrap_or(50);

    let results = sqlx::query_as::<_, (String, String, f64)>(
        r"
        SELECT t.file_path, t.tag_name, t.confidence
        FROM image_ai_tags t
        INNER JOIN files f ON t.file_path = f.path
        WHERE t.tag_name LIKE ?
          AND t.confidence >= ?
        ORDER BY t.confidence DESC
        LIMIT ?
        ",
    )
    .bind(format!("%{tag_query}%"))
    .bind(f64::from(min_conf))
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;

    Ok(results
        .into_iter()
        .map(|(path, tag, confidence)| {
            let name = std::path::Path::new(&path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            AiTagSearchResult {
                path,
                name,
                tag,
                confidence: confidence as f32,
            }
        })
        .collect())
}

/// 取得所有可用的 AI 標籤 (用於自動完成)
/// Get all available AI tags (for autocomplete)
pub async fn get_all_ai_tags(pool: &Pool<Sqlite>) -> Result<Vec<(String, i32)>, AppError> {
    let results = sqlx::query_as::<_, (String, i32)>(
        r"
        SELECT tag_name, COUNT(*) as count 
        FROM image_ai_tags
        GROUP BY tag_name
        ORDER BY count DESC
        LIMIT 100
        ",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Anyhow(anyhow::anyhow!(e)))?;

    Ok(results)
}
