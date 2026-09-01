/**
 * 檔案路徑的字串運算。
 *
 * ⚠️ 這支模組存在的理由跟 `lib/format.ts` 一樣：同樣的三行三元式在
 * `Finder` 裡出現十次以上，`Toolbar`、`FileList`、`SpotlightSearch`、
 * `MobileLayout` 各自又有一份。重複本身不是問題，問題是**每一份對邊界的
 * 看法可以不一樣**，而沒有任何一份有測試。
 *
 * 這裡的路徑一律是「以 `/` 開頭的絕對路徑，相對於儲存根」，
 * 根目錄就是 `"/"`。要送給 API 的相對形式用 [`toApiPath`]。
 */

/**
 * 把目前的目錄與一個項目名稱接起來。
 *
 * ⚠️ 根目錄要特判，否則 `"/" + "/" + name` 會產生 `"//name"`。
 * 後端的 `StorageRoot::resolve` 擋得住那種路徑（`//` 會被 `Path::components`
 * 摺疊掉），但那是靠運氣 —— 而且它會原封不動出現在 URL 與畫面上。
 */
export function joinPath(dir: string, name: string): string {
  // ⚠️ 這裡原本先特判 `dir === "/" || dir === ""`。變異測試指出那是**冗餘**的：
  // `"/".replace(/\/+$/, "")` 本來就是 `""`，`""` 也是。
  // 散落各處的三元式需要特判，是因為它們用的是字串相接而不是先去尾。
  const base = dir.replace(/\/+$/, "");
  return `${base}/${name}`;
}

/**
 * 上一層目錄。
 *
 * ⚠️ 結尾的斜線要先去掉。原本散落各處的 `substring(0, lastIndexOf("/"))`
 * 對 `"/a/b/"` 會回 `"/a/b"`（自己），於是「上一頁」按了沒反應。
 */
export function dirName(path: string): string {
  // Stryker disable next-line StringLiteral: 等價突變。替換字串只會在尾端補上
  // 不含斜線的文字，而 `lastIndexOf("/")` 不受尾端非斜線字元影響、
  // `slice(0, cut)` 又切在它前面 —— 沒有任何輸入分得出替換成別的字串。
  // （這裡真正重要的是那個 `+`，而它有測試守著：見 "多個結尾斜線" 那條。）
  const trimmed = path.replace(/\/+$/, "");
  // ⚠️ 這裡原本還有 `if (trimmed === "" || trimmed === "/") return "/"`。
  // 變異測試指出兩半都是死的：去尾之後 `"/"` 已經變成 `""`，
  // 而 `"".lastIndexOf("/")` 是 -1，下面的 `cut <= 0` 本來就回 `"/"`。
  const cut = trimmed.lastIndexOf("/");
  return cut <= 0 ? "/" : trimmed.slice(0, cut);
}

/**
 * 絕對路徑 → 送給 API 的相對形式（去掉開頭的斜線，根目錄是空字串）。
 *
 * ⚠️ 根目錄一定要是 `""` 而不是 `"/"`：後端把它接在儲存根後面，
 * `"/"` 會變成 `"//檔名"`。
 */
export function toApiPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * 拆成麵包屑用的片段。
 *
 * 根目錄回空陣列 —— 空字串的片段（來自 `//` 或開頭的斜線）一律濾掉，
 * 否則麵包屑上會出現一個沒有名字、點了會跳到怪路徑的項目。
 */
export function pathSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

/**
 * 麵包屑上第 `index` 個片段對應的絕對路徑。
 *
 * `pathSegments` 回的是名字，點下去要導到的是**到那一段為止**的路徑。
 * 這兩件事分開寫的話很容易 off-by-one（少一段或多一段）。
 */
export function pathUpTo(path: string, index: number): string {
  const segments = pathSegments(path).slice(0, index + 1);
  // 空陣列 join 出來是空字串，樣板本來就產生 "/" —— 不需要特判（變異測試指出的）
  return `/${segments.join("/")}`;
}
