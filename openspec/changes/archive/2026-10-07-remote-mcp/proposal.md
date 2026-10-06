## Why

OpenSlide 目前的 MCP server 只適合與工具執行在同一台機器的 stdio 情境，產物回傳本機路徑；遠端 agent、CI 或 container client 無法直接預覽投影片或下載 export 結果。CLI 已具備 Vite dev/preview server 與 static export 能力，適合補上一層受控的 remote MCP，而不改變既有 CLI 或 stdio 使用方式。

## What Changes

- 新增可透過 HTTP 運作的 remote MCP server entrypoint。
- 保留現有 stdio MCP，兩種 transport 共用相同的 tool contract 與 core/CLI 實作。
- 新增 `open_slide_dev` 與 `open_slide_preview`，回傳 client 可存取的 URL 與 session 資訊。
- 讓 build、export-html，以及後續的 Zola export 在 remote 模式回傳短效 artifact URL；stdio 模式維持回傳本機路徑。
- 建立 artifact/session 生命週期、過期清理、路徑隔離與基本認證邊界。
- 補上 remote MCP 的安裝、部署、反向代理與安全設定文件。
- 不改變 `open-slide dev`、`open-slide preview`、`--open` 的既有 CLI 行為。

## Capabilities

### New Capabilities

- `remote-mcp`: HTTP remote MCP transport、tool invocation、preview session 與 artifact URL 合約。

### Modified Capabilities

- 無。現有 stdio MCP 與 CLI 的需求維持相容；remote 行為以新 capability 定義。

## Impact

- 主要影響 `packages/mcp` 的 server entrypoint、transport、session/artifact 管理與測試。
- 應優先使用 MCP SDK 與 Node/Vite 現有能力，避免引入完整 Web framework。
- `packages/core` 的 preview/dev API 可能需要抽出可取得 URL、port 與 close handle 的共用結果型別。
- `packages/mcp` 需要 changeset；若 core public API 被修改，`@open-slide/core` 也需要 changeset。
