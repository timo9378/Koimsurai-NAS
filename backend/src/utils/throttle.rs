use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 針對「公開端點上的密碼嘗試」的次數限制。
///
/// ⚠️ 為什麼需要它：分享連結與上傳連結是**不需要登入**就打得到的，而密碼比對
/// 走 argon2。兩個後果：
///
/// 1. **可以暴力破解。** 沒有任何次數上限，唯一的成本是每次驗證的時間。
/// 2. **一個請求換一次 argon2。** `Argon2::default()` 是 19 MiB 的記憶體硬化
///    參數，而 `spawn_blocking` 的池預設 512 條執行緒 —— 灌併發請求可以逼出
///    近 10 GB 的配置。這台機器就是 NAS 本身，上面還跑著別的服務。
///    （`middleware/basic_auth.rs` 的憑證快取解的是同一類問題。）
///
/// key 用**連結 id**而不是來源 IP：這個服務跑在反向代理後面，IP 常常是代理的。
/// 代價是攻擊者可以用失敗次數把某個連結鎖到窗口結束 —— 用「滑動窗口」而不是
/// 永久鎖定就是為了把那個代價壓到可接受：正常使用者不會在 5 分鐘內打錯 10 次。
pub struct AttemptLimiter {
    inner: Mutex<HashMap<String, Attempts>>,
    max_failures: u32,
    window: Duration,
}

struct Attempts {
    count: u32,
    /// 窗口的起點。過了 `window` 就整筆重新開始。
    since: Instant,
}

impl AttemptLimiter {
    pub fn new(max_failures: u32, window: Duration) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_failures,
            window,
        }
    }

    /// 現在還能不能再試一次。
    pub fn allows(&self, key: &str) -> bool {
        self.allows_at(key, Instant::now())
    }

    /// 記一次失敗。
    pub fn record_failure(&self, key: &str) {
        self.record_failure_at(key, Instant::now());
    }

    /// 成功之後把紀錄清掉 —— 不然一個打錯幾次才輸對的人會被後續的請求誤鎖。
    pub fn reset(&self, key: &str) {
        // ⚠️ 鎖中毒（別的執行緒 panic）時不要一起 panic：那會讓一個 handler 的
        // 意外變成整個端點掛掉。限制器失效比服務掛掉好。
        if let Ok(mut map) = self.inner.lock() {
            map.remove(key);
        }
    }

    fn allows_at(&self, key: &str, now: Instant) -> bool {
        let Ok(map) = self.inner.lock() else {
            return true;
        };
        map.get(key)
            .is_none_or(|a| now.duration_since(a.since) >= self.window || a.count < self.max_failures)
    }

    fn record_failure_at(&self, key: &str, now: Instant) {
        let Ok(mut map) = self.inner.lock() else {
            return;
        };

        // 順手清掉過期的紀錄。key 是資料庫裡存在的連結 id，本來就有上限，
        // 但沒有這段的話刪掉的連結會一直留在表裡。
        map.retain(|_, a| now.duration_since(a.since) < self.window);

        let entry = map
            .entry(key.to_string())
            .or_insert(Attempts { count: 0, since: now });
        if now.duration_since(entry.since) >= self.window {
            entry.count = 0;
            entry.since = now;
        }
        entry.count += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOW: Duration = Duration::from_secs(300);

    fn limiter() -> AttemptLimiter {
        AttemptLimiter::new(3, WINDOW)
    }

    #[test]
    fn allows_until_the_limit_is_reached() {
        let l = limiter();
        let t = Instant::now();
        for _ in 0..3 {
            assert!(l.allows_at("link", t), "還沒到上限就要放行");
            l.record_failure_at("link", t);
        }
        assert!(!l.allows_at("link", t), "到上限之後要擋下來");
    }

    #[test]
    fn the_window_resets_the_budget() {
        let l = limiter();
        let t = Instant::now();
        for _ in 0..3 {
            l.record_failure_at("link", t);
        }
        assert!(!l.allows_at("link", t));
        assert!(
            l.allows_at("link", t + WINDOW),
            "滑動窗口過了要重新放行 —— 永久鎖定等於讓攻擊者能鎖死別人的連結"
        );
    }

    #[test]
    fn different_keys_do_not_share_a_budget() {
        let l = limiter();
        let t = Instant::now();
        for _ in 0..3 {
            l.record_failure_at("a", t);
        }
        assert!(!l.allows_at("a", t));
        assert!(l.allows_at("b", t), "另一個連結不該被連坐");
    }

    #[test]
    fn success_clears_the_record() {
        let l = limiter();
        let t = Instant::now();
        l.record_failure_at("link", t);
        l.record_failure_at("link", t);
        l.reset("link");
        for _ in 0..3 {
            assert!(l.allows_at("link", t), "成功之後額度要回滿");
            l.record_failure_at("link", t);
        }
    }

    #[test]
    fn expired_entries_are_pruned() {
        let l = limiter();
        let t = Instant::now();
        l.record_failure_at("old", t);
        l.record_failure_at("new", t + WINDOW);
        let (has_old, has_new) = {
            let map = l.inner.lock().expect("lock");
            (map.contains_key("old"), map.contains_key("new"))
        };
        assert!(!has_old, "過期的紀錄要被清掉");
        assert!(has_new);
    }

    #[test]
    fn an_unknown_key_is_always_allowed() {
        assert!(limiter().allows_at("never-seen", Instant::now()));
    }
}
