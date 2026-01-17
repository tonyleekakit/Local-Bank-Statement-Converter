# 銀行月結單PDF轉Excel轉換器

一個安全的前後端架構應用，用於將銀行月結單 PDF 轉換為 Excel 格式。

## 架構

- **前端**：Cloudflare Pages（從 GitHub 自動部署）
- **後端**：Supabase Edge Functions（API 代理）
- **認證**：Supabase Auth（支持多種登入方式）
- **數據庫**：Supabase PostgreSQL（用戶數據、使用記錄）
- **Document AI**：Google Cloud（通過 Edge Functions 調用）
- **訂閱**：Stripe（通過 Edge Functions 集成，未來擴展）

## 快速開始

### 1. 設置 Supabase 項目

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 創建新項目
2. 記錄 API URL 和 anon key
3. 在 SQL Editor 中執行 `supabase/migrations/001_initial_schema.sql`
4. 在 Edge Functions 設置中添加環境變數：
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: Google Cloud Service Account JSON 內容

### 2. 部署 Supabase Edge Function

```bash
# 安裝 Supabase CLI
npm install -g supabase

# 登入 Supabase
supabase login

# 鏈接到項目
supabase link --project-ref your-project-ref

# 部署 Edge Function
supabase functions deploy documentai-process
```

### 3. 設置前端環境變數

在 Cloudflare Pages Dashboard 或 `.env` 文件中設置：

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. 部署到 Cloudflare Pages

1. 將代碼推送到 GitHub
2. 在 Cloudflare Pages 中連接 GitHub 倉庫
3. 設置構建配置：
   - 構建命令：無（純靜態文件）
   - 構建輸出目錄：`frontend`
4. 添加環境變數（見步驟 3）

## 項目結構

```
bank-statement-converter/
├── frontend/              # 前端代碼
│   ├── index.html
│   ├── script.js
│   ├── auth.js           # 認證邏輯
│   └── ...
├── supabase/            # Supabase 配置
│   ├── functions/
│   │   └── documentai-process/
│   │       └── index.ts
│   └── migrations/      # 數據庫遷移
│       └── 001_initial_schema.sql
├── .github/
│   └── workflows/
│       └── deploy.yml   # Cloudflare Pages 部署
└── .env.example         # 環境變數示例
```

## 安全考慮

1. **認證**：所有 API 調用都需要 Supabase Auth token
2. **Row Level Security**：數據庫層面的權限控制
3. **環境變數**：敏感信息存儲在服務器端
4. **CORS**：正確配置跨域策略
5. **Rate Limiting**：在 Edge Functions 中實現請求限制（未來擴展）

## 開發

### 本地開發

1. 安裝依賴（如果需要）：
```bash
npm install
```

2. 啟動本地開發服務器：
```bash
# 使用任何靜態文件服務器，例如：
npx serve frontend
# 或
python -m http.server 8000 -d frontend
```

3. 設置環境變數（在 `frontend/` 目錄創建 `.env` 文件）

### 測試 Supabase Edge Function 本地

```bash
supabase functions serve documentai-process
```

## 許可證

MIT
