"""給 api-fuzz 用的 schemathesis hook。

⚠️ tus 的請求 body 是 `application/offset+octet-stream`（協定規定的）。
schemathesis 不認得這個 media type，於是對 `POST /api/tus` 與
`PATCH /api/tus/{id}` 兩個 operation 直接報 `Serialization not possible`
並讓整個 run 變成 error —— 那不是伺服器的問題，也不是規格漂移，
純粹是工具不知道怎麼產那種 body。

它的位元組語意跟 `application/octet-stream` 完全一樣，所以直接沿用內建的
序列化器。這樣兩個 operation 才會真的被 fuzz，而不是被跳過。

載入方式（見 .github/workflows/api-fuzz.yml）：
    PYTHONPATH=scripts SCHEMATHESIS_HOOKS=schemathesis_hooks st run ...
"""

import schemathesis

schemathesis.serializer.alias(
    "application/offset+octet-stream",
    "application/octet-stream",
)
