/** 分塊上傳的預設大小（5 MiB）。 */
export const CHUNK_SIZE = 5 * 1024 * 1024;

export interface Chunk {
  /** 這一塊在檔案裡的起始位元組（也就是要送給伺服器的 offset）。 */
  readonly start: number;
  /** 結束位元組（不含）。 */
  readonly end: number;
}

/**
 * 算出從 `startOffset` 開始還要送哪些分塊。
 *
 * ⚠️ 這裡的重點是**從 `startOffset` 這個位元組開始，不是從它所在的分塊開始**。
 *
 * 原本的寫法是：
 *
 *     const startChunkIndex = Math.floor(startOffset / CHUNK_SIZE);
 *     for (let i = startChunkIndex; i < totalChunks; i++) {
 *       const start = i * CHUNK_SIZE;   // ← 早於 startOffset
 *
 * `startOffset` 不是分塊大小的整數倍時（也就是**上一次剛好斷在分塊中間**——
 * 而那正是續傳會發生的情境），`Math.floor` 會退回那一塊的開頭，於是已經寫進
 * 伺服器的那段位元組被**重複送一次**。伺服器是 append 模式，結果是一個比原檔
 * 更長、內容錯位的檔案，而上傳回報成功。
 *
 * 這個 bug 之所以一直是靜默的，是因為客戶端從來沒送過 `X-Upload-Offset` ——
 * 伺服器端的位移檢查（見 backend/src/handlers/upload.rs）因此從未被觸發。
 * 兩個問題互相掩蓋。
 */
export function planChunks(fileSize: number, startOffset = 0, chunkSize = CHUNK_SIZE): Chunk[] {
  if (chunkSize <= 0) {
    throw new RangeError(`chunkSize 必須是正數，收到 ${chunkSize}`);
  }

  // ⚠️ 空檔案也要送一塊（空的）。不送的話伺服器的工作階段永遠不會達到
  //    「已收 >= 總長」而完成，檔案就一直卡在暫存區。
  if (fileSize === 0) {
    return startOffset > 0 ? [] : [{ start: 0, end: 0 }];
  }

  const from = Math.max(0, Math.min(startOffset, fileSize));
  const chunks: Chunk[] = [];
  for (let start = from; start < fileSize; start += chunkSize) {
    chunks.push({ start, end: Math.min(start + chunkSize, fileSize) });
  }
  return chunks;
}
