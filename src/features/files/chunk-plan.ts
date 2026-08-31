/**
 * 上傳的分塊大小。
 *
 * ⚠️ 這支檔案原本還有一個 `planChunks(fileSize, startOffset)` —— 由**客戶端**
 * 算出每一塊的起訖。前端改用 tus（`tus-upload.ts`）之後它就沒有呼叫者了，
 * 因為 tus 每次續傳前會先 HEAD 問伺服器 offset 在哪，客戶端沒有猜測的餘地。
 *
 * 那正是它存在期間修掉的 bug：舊寫法 `Math.floor(startOffset / CHUNK_SIZE)`
 * 會把起點退回分塊開頭，斷在分塊中間時會重送已經寫進伺服器的位元組
 * （append 模式 → 檔案變長且錯位，而且沒有任何錯誤訊息）。
 * 完整的來龍去脈與當時的 property test 見 git 歷史與 MIGRATION_PLAN.md。
 */
export const CHUNK_SIZE = 5 * 1024 * 1024;
