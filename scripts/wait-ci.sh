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

while :; do
  json="$(runs_json)"
  done_count=$(echo "$json" | jq '[.[] | select(.status == "completed")] | length')
  want=${#EXPECTED[@]}

  if [ "$done_count" -ge "$want" ]; then
    break
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "⏱  等了 ${TIMEOUT}s，$short 的 CI 還沒跑完（完成 $done_count / 需要 $want）：" >&2
    echo "$json" | jq -r '.[] | "   \(.name) \(.status) \(.conclusion // "-")"' >&2
    exit 2
  fi
  sleep 20
done

echo "$json" | jq -r '.[] | "\(.name)\t\(.conclusion)"' | sort

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
