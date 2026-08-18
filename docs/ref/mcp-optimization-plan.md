# MCP Toolchain Optimization Plan

> 基於 OpenSlide MCP 合約盤點結果，針對 BloggerAgent 整合場景提出的 7 項優化。
> 優先順序：P0（高）→ P1 → P2（低）。

## P0 — 高優先

### 1. ClearErrorStack
- **檔案**: `packages/core/src/vite/routes/assets.ts:292`
- **問題**: 500 錯誤回應缺少堆疊追蹤，Client 端無法除錯。
- **解法**: 在 JSON 錯誤回應中加入 `stack` 欄位。
- **風險**: 無。僅增加除錯資訊。

### 2. ParallelDriftCheck
- **檔案**: `packages/core/src/cli/sync.ts:40-53`
- **問題**: `detectSkillsDrift` 的迴圈為串行，N 個技能目錄需 N 次 SHA256 計算。
- **解法**: 改用 `Promise.all` 平行化。
- **風險**: 低。純效能優化。

## P1 — 中優先

### 3. SizeCheckOnDrift
- **檔案**: `packages/core/src/cli/sync.ts`
- **問題**: 每次漂移檢查都做完整 SHA256，即使檔案沒變。
- **解法**: 先比對檔案數量 + 總大小，不符才做 SHA256。
- **風險**: 低。quick-fail 優化。

### 4. ZodValidation
- **檔案**: `packages/core/src/vite/routes/context.ts:56-60`
- **問題**: `readBody` 使用 `JSON.parse` 後無型別驗證，Caller 需自行 `as` 轉型。
- **解法**: 加入型別檢查（回傳 `Record<string, unknown>` 確保為物件），避免新增依賴。
- **風險**: 低。僅增加執行期型別安全。

## P2 — 低優先

### 5. UnifiedErrorHandling
- **檔案**: `packages/mcp/src/index.ts`
- **問題**: 4 個 tool handler 各自有 try/catch，錯誤格式不一致。
- **解法**: 抽共用 error wrapper helper。
- **風險**: 低。純重構。

### 6. NaNPortGuard ✅ 已完成
- **檔案**: `packages/core/src/cli/run.ts:17-23`
- **狀態**: `parsePort` 已使用 `Number.isInteger`，NaN 已正確防護。

### 7. PreCheckSkillsDir ✅ 已完成
- **檔案**: `packages/core/src/cli/sync.ts:57-62`
- **狀態**: `syncSkills` 與 `detectSkillsDrift` 已檢查目錄存在。
