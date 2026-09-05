#!/usr/bin/env bash
#
# 等某個 commit 的 CI 跑完，**紅燈就 exit 非零**。
#
# ⚠️ 為什麼需要這支：先前是每次手打一段 `for i in $(seq 1 30) … gh run list --limit 2`。
# 那段有三個問題，而且是靜默的：
#
#   1. 最終報告沒有依 SHA 過濾 —— 印的是「最近兩筆 run」而不是「這個 commit 的」，
#      期間有新的 push 就會印到別人的結果。
#   2. 迴圈只等 `status == "completed"`，從不看 `conclusion`。
#   3. **它永遠 exit 0** —— 紅燈跟綠燈在指令層面沒有差別，全靠人用眼睛讀輸出。
#      實際後果：有一次 clippy 紅了而我沒發現，直接往下一個題目走了。
#
# 用法：scripts/wait-ci.sh [sha] [逾時秒數]
set -euo pipefail

SHA="${1:-$(git rev-parse HEAD)}"
TIMEOUT="${2:-1800}"
# 這個 commit 應該要有的 workflow（缺一不可，不然「還沒排上」會被當成通過）
EXPECTED=("CI" "E2E")

short="${SHA:0:7}"
deadline=$(( $(date +%s) + TIMEOUT ))

runs_json() {
  gh run list --limit 30 --json name,status,conclusion,headSha \
    --jq "[.[] | select(.headSha | startswith(\"$short\"))]"
}

# ⚠️ 等的是「EXPECTED 這幾個都跑完了」，不是「完成的 run 數量夠多」。
# 原本是數 `status == "completed"` 的總數再跟 EXPECTED 的個數比 ——
# 只要同一個 SHA 上有別的 workflow（例如手動觸發的 E2E Flake Sweep）先跑完，
# 就會在 CI／E2E 還在跑的時候提早跳出迴圈。那不會誤報綠燈（底下逐一檢查
# 會把它們判成 missing），但會把「還在跑」講成「失敗」，一樣是錯的訊息。
expected_pending() {
  local name
  for name in "${EXPECTED[@]}"; do
    if [ "$(echo "$json" | jq -r --arg n "$name" \
      '[.[] | select(.name == $n and .status == "completed")] | length')" -eq 0 ]; then
      printf '%s ' "$name"
    fi
  done
}

while :; do
  json="$(runs_json)"
  pending="$(expected_pending)"

  if [ -z "$pending" ]; then
    break
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "⏱  等了 ${TIMEOUT}s，$short 的 CI 還沒跑完（還在等：$pending）：" >&2
    echo "$json" | jq -r '.[] | "   \(.name) \(.status) \(.conclusion // "-")"' >&2
    exit 2
  fi
  sleep 20
done

# ⚠️ 摘要要標出哪幾行**不列入判斷**。
# 原本是把同一個 SHA 上的每個 run 都印成「名字＋結論」，結論還在跑的就是空的
# —— 底下緊接著一行「✅ 全綠」，讀起來像是上面每一行都綠了。這個 repo 已經
# 因為「綠燈在說謊」踩過太多次，摘要自己不能是下一次。
expected_pattern="$(printf '%s\n' "${EXPECTED[@]}" | paste -sd '|' -)"
echo "$json" | jq -r --arg want "$expected_pattern" '
  .[]
  | . as $r
  | ($r.name | test("^(" + $want + ")$")) as $judged
  # gh 對還在跑的 run 送的 conclusion 是**空字串**不是 null，`//` 接不到，
  # 印出來就是一個空欄位 —— 那正是原本讓人誤讀的地方。
  | (if (($r.conclusion // "") == "") then $r.status else $r.conclusion end) as $state
  | if $judged
    then "\($r.name)\t\($state)"
    else "\($r.name)\t\($state)\t(不列入判斷)"
    end' | sort

# 每一個期待的 workflow 都要存在且成功
fail=0
for name in "${EXPECTED[@]}"; do
  conclusion="$(echo "$json" | jq -r --arg n "$name" \
    '[.[] | select(.name == $n)] | first | .conclusion // "missing"')"
  if [ "$conclusion" != "success" ]; then
    echo "❌ $name: $conclusion" >&2
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "CI 沒有全綠（$short）" >&2
  exit 1
fi

echo "✅ $short 全綠"
