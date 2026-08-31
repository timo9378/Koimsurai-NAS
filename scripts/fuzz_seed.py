"""在 api-fuzz 的臨時實例裡種一批真資料，並產出 schemathesis 的設定檔。

⚠️ 為什麼需要這個
-----------------
schemathesis 從 OpenAPI spec 產參數值，而路徑參數多半是 UUID 或檔名 ——
隨機產出來的一律不存在，於是那些 operation **每一次都拿到 404**，
一次也沒進到 handler 本體。schemathesis 自己會警告：

    Missing test data: 9 operations repeatedly returned 404 Not Found,
    preventing tests from reaching your API's core logic

「有被測到」跟「測進去了」是兩件事，而報告上看起來一樣。

做法：先用真的 API 建出資源（檔案、圖片、標籤、分享連結、上傳工作階段、
tus 上傳、垃圾桶項目），把拿到的 ID 寫成 `[[operations]] parameters`，
schemathesis 就會拿真的值去打。

⚠️ 只對這裡起的臨時實例跑，絕對不要對 production —— 它會建檔、刪檔。
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

# 1×1 的透明 PNG，給 thumbnail 端點用（它只吃得下真的圖片）
PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a"  # 簽章
    "0000000d49484452000000010000000108060000001f15c489"  # IHDR：1×1、8-bit RGBA
    "0000000b49444154789c6360000200000500017a5eab3f"  # IDAT：一個全透明像素
    "0000000049454e44ae426082"  # IEND
)


class Api:
    def __init__(self, base: str, cookie: str) -> None:
        self.base = base.rstrip("/")
        self.cookie = cookie

    def _req(self, method: str, path: str, *, body: bytes | None = None,
             content_type: str | None = None, extra: dict[str, str] | None = None):
        headers = {"Cookie": self.cookie, "Origin": self.base}
        if content_type:
            headers["Content-Type"] = content_type
        headers.update(extra or {})
        req = urllib.request.Request(f"{self.base}{path}", data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                return res.status, dict(res.headers), res.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def json(self, method: str, path: str, payload: object | None = None, **kw):
        body = json.dumps(payload).encode() if payload is not None else None
        status, headers, raw = self._req(
            method, path, body=body, content_type="application/json" if payload is not None else None, **kw
        )
        try:
            return status, headers, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return status, headers, None

    def multipart(self, path: str, filename: str, content: bytes):
        boundary = "----fuzzseed"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
        return self._req("POST", path, body=body, content_type=f"multipart/form-data; boundary={boundary}")


def created(status: int) -> bool:
    """種子步驟是否可以當成成功。

    ⚠️ 409 也算 —— 那表示資源**已經存在**，而我們要的正是「它存在」。
    對同一個實例重跑時（本機除錯）第二次會全是 409，把它當失敗的話
    設定檔會少掉一半的參數，而症狀是「fuzz 突然變淺」看不出原因。
    """
    return status < 400 or status == 409


def b64(s: str) -> str:
    import base64
    return base64.b64encode(s.encode()).decode()


# ⚠️ 破壞性的 operation（restore、delete）第一次呼叫就把資源消耗掉，
# 之後每一次都 404。schemathesis 預設每個 operation 產 20 個案例
# （--max-examples 20），所以每一種要種到夠 —— 種一份的話 1 次成功、
# 19 次 404，報告上仍然是「mostly 404」。
SEED_COUNT = 25


def seed(api: Api) -> dict[str, list[str]]:
    """建資料，回傳每個參數的候選值。取不到就略過 —— 種子失敗不該讓整個 fuzz 停擺。"""
    out: dict[str, list[str]] = {}

    def put(key: str, value: str | None) -> None:
        if value:
            out.setdefault(key, []).append(value)

    # ── 一般檔案（download / tags）─────────────────────────────
    status, _, _ = api.multipart("/api/upload", "fuzz-seed.txt", b"seed content for api-fuzz")
    if created(status):
        put("file_path", "fuzz-seed.txt")

    # ── 圖片（thumbnail）──────────────────────────────────────
    status, _, _ = api.multipart("/api/upload", "fuzz-seed.png", PNG_1X1)
    if created(status):
        put("image_path", "fuzz-seed.png")

    # ── 標籤 ─────────────────────────────────────────────────
    # DELETE /api/files/{path}/tags/{tag_name} 會把標籤移掉，所以每個標籤
    # 只夠用一次。
    for i in range(SEED_COUNT):
        name = f"fuzzseed{i}"
        status, _, _ = api.json("POST", "/api/tags/add/fuzz-seed.txt", {"tag_name": name})
        if created(status):
            put("tag_name", name)

    # ── 分享連結（/s/{id}）────────────────────────────────────
    for _ in range(SEED_COUNT):
        status, _, data = api.json("POST", "/api/share", {"file_path": "fuzz-seed.txt"})
        if created(status) and isinstance(data, dict):
            put("share_id", data.get("id"))

    # ── 分塊上傳工作階段（/api/upload/session/{id}）────────────
    for i in range(SEED_COUNT):
        status, _, data = api.json(
            "POST", "/api/upload/init",
            {"file_path": "", "file_name": f"fuzz-session-{i}.bin", "total_size": 1024},
        )
        if created(status) and isinstance(data, dict):
            put("session_id", data.get("upload_id"))

    # ── tus 上傳（/api/tus/{id}）──────────────────────────────
    # DELETE /api/tus/{id} 會終止上傳，HEAD 之後就 404 —— 兩個共用同一批 id。
    for i in range(SEED_COUNT):
        status, headers, _ = api._req(
            "POST", "/api/tus",
            extra={
                "Tus-Resumable": "1.0.0",
                "Upload-Length": "1024",
                "Upload-Metadata": f"filename {b64(f'fuzz-tus-{i}.bin')}",
            },
        )
        location = headers.get("Location") or headers.get("location")
        if created(status) and location:
            put("tus_id", location.rsplit("/", 1)[-1])

    # ── 垃圾桶項目（/api/trash/{filename}）─────────────────────
    # POST 是「還原」，會把檔案搬出垃圾桶。
    for i in range(SEED_COUNT):
        api.multipart("/api/upload", f"fuzz-trash-{i}.txt", b"to be deleted")
        api.json("POST", "/api/files/batch/delete", {"paths": [f"fuzz-trash-{i}.txt"]})
    status, _, data = api.json("GET", "/api/trash")
    if created(status) and isinstance(data, list):
        for item in data:
            put("trash_filename", item.get("name"))

    # ── 稽核紀錄（/api/audit/logs/{id}）────────────────────────
    #
    # ⚠️ 不是每個動作都會寫 audit log —— 上傳就不會，建資料夾才會。
    # 少了這一步，audit 的清單是空的，DELETE /api/audit/logs/{id}
    # 就永遠拿 404。
    for i in range(SEED_COUNT):
        api.json("POST", "/api/files/folder", {"path": "", "folder_name": f"fuzz-seed-dir-{i}"})
    status, _, data = api.json("GET", f"/api/audit/logs?page=1&limit={SEED_COUNT}")
    rows = data.get("logs") if isinstance(data, dict) else data
    if created(status) and isinstance(rows, list):
        for row in rows:
            if row.get("id") is not None:
                put("audit_id", str(row["id"]))

    return out


def toml_config(v: dict[str, list[str]]) -> str:
    """把種好的值寫成 schemathesis 的參數覆寫。

    多個候選值用 `[dictionaries.*]`，schemathesis 會從裡面抽 —— 破壞性的
    operation 才不會第一次之後就全部 404。
    """
    head: list[str] = [
        "# 由 scripts/fuzz_seed.py 產生 —— 不要手改。",
        "# 這些是**真的存在**的資源 ID，讓 schemathesis 打得進 handler 本體",
        "# 而不是每次都拿到 404。",
        "",
    ]
    dicts: list[str] = []
    ops: list[str] = []
    seen: set[str] = set()

    def dictionary(key: str) -> str | None:
        """把 `key` 的候選值寫成一個字典，回傳字典名稱。"""
        values = v.get(key) or []
        if not values:
            return None
        if key not in seen:
            seen.add(key)
            items = ", ".join(f'"{x}"' for x in values)
            dicts.append(f"[dictionaries.{key}]")
            dicts.append(f"values = [{items}]")
            dicts.append("")
        return key

    def block(name: str, params: dict[str, str], literals: dict[str, str] | None = None) -> None:
        """params：參數名 → 種子的 key。任何一個湊不齊就整塊略過。

        literals 是固定值（例如縮圖尺寸），不需要種資料。
        ⚠️ 同一個 operation 只能有一個 `[[operations]]` 區塊 —— 拆成兩塊
        會互相蓋掉，而症狀是其中一個參數安靜地失效。
        """
        resolved = {p: dictionary(k) for p, k in params.items()}
        if not all(resolved.values()):
            return
        parts = [f'"{p}" = {{ dictionary = "{d}" }}' for p, d in resolved.items()]
        parts += [f'"{p}" = "{val}"' for p, val in (literals or {}).items()]
        ops.append("[[operations]]")
        ops.append(f'include-name = "{name}"')
        ops.append(f"parameters = {{ {', '.join(parts)} }}")
        ops.append("")

    block("GET /api/download/{path}", {"path": "file_path"})
    block("GET /api/thumbnail/{size}/{path}", {"path": "image_path"}, {"size": "256"})
    block("DELETE /api/files/{path}/tags/{tag_name}", {"path": "file_path", "tag_name": "tag_name"})
    block("POST /api/files/{path}/tags", {"path": "file_path"})
    block("POST /api/files/{path}/star", {"path": "file_path"})
    block("GET /s/{id}", {"id": "share_id"})
    block("GET /api/upload/session/{id}", {"id": "session_id"})
    block("PATCH /api/upload/session/{id}", {"id": "session_id"})
    block("HEAD /api/tus/{id}", {"id": "tus_id"})
    block("DELETE /api/tus/{id}", {"id": "tus_id"})
    block("PATCH /api/tus/{id}", {"id": "tus_id"})
    block("POST /api/trash/{filename}", {"filename": "trash_filename"})
    block("DELETE /api/audit/logs/{id}", {"id": "audit_id"})

    return "\n".join(head + dicts + ops) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="例如 http://127.0.0.1:3099")
    ap.add_argument("--cookie", required=True, help="access_token=...")
    ap.add_argument("--out", required=True, help="要寫出的 schemathesis.toml")
    args = ap.parse_args()

    values = seed(Api(args.base, args.cookie))
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(toml_config(values))

    summary = ", ".join(f"{k}×{len(vs)}" for k, vs in sorted(values.items()))
    print(f"種好：{summary or '（無）'}", file=sys.stderr)
    # ⚠️ 種子失敗不讓整個 job 紅：少幾個真實值只是 fuzz 打得淺一點，
    # 而 schemathesis 自己會用警告告訴我們哪些 operation 還在拿 404。
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
