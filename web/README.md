# 股票记账 Phase 1（前端）

## 本地运行

```bash
cd web
copy .env.example .env
# 编辑 .env 填入 Supabase URL 与 anon key
npm install
npm run dev
```

浏览器打开 http://localhost:5173 。在 Supabase **Authentication → URL Configuration** 中加入：

- `http://localhost:5173/**`
- 部署 GitHub Pages 后的地址，如 `https://<user>.github.io/<repo>/**`

## GitHub Pages

1. 仓库 **Settings → Pages**：Source 选 **GitHub Actions**。  
2. 在 **Settings → Secrets and variables → Actions** 添加 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。  
3. 若站点在子路径，添加 `VITE_BASE` 为 `/仓库名/`。  
4. push 到 `main` 触发 [.github/workflows/pages.yml](.github/workflows/pages.yml)。

## 数据库

迁移 SQL 在 [../supabase/migrations/001_initial_schema.sql](../supabase/migrations/001_initial_schema.sql)。
