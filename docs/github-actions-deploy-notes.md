# GitHub Actions 部署踩坑记录（GitHub Pages + Vite）

本文档总结在本仓库将前端部署到 **GitHub Pages**（`.github/workflows/pages.yml`）过程中，Actions 里实际遇到的问题、原因与处理方式。**UTF-8（无 BOM）** 保存。

---

## 问题一：工作流被判为「Invalid workflow file」且常指向第 1 行

### 现象

- Actions 中工作流在**解析阶段**失败，提示 **`Invalid workflow file`**、**`You have an error in your yaml syntax`**，注解多指向 **`.github/workflows/pages.yml` 第 1 行**。
- 本地肉眼查看 YAML 结构看似正常。

### 原因

- 工作流文件实际以 **UTF-16 LE**（或其它非 UTF-8 编码）保存。GitHub Actions **按 UTF-8 解析**工作流；UTF-16 字节流会被误判为非法 YAML，从而报语法错误。
- 在 Windows 上若使用易默认 UTF-16 的工具保存，或从别处复制时带入错误编码，易出现此问题。

### 处理

- 用编辑器将 `.github/workflows/pages.yml` **另存为 UTF-8（建议无 BOM）**，或使用脚本显式以 UTF-8 无 BOM 写盘（例如 .NET `UTF8Encoding(false)` / Node `fs.writeFileSync(..., "utf8")`）。
- 简单自查：文件头字节中，UTF-8 下 `name` 为 `6E 61 6D 65`；若为 `6E 00 61 00 ...` 则为 UTF-16 LE。

### 预防

- 在 Cursor / VS Code 中保存工作流时，确认右下角编码为 **UTF-8**。
- 仓库内规则：`.cursor/rules/github-workflows-encoding.mdc`（约束 `.github/` 下文件编码）。

---

## 问题二：构建阶段 `vite: Permission denied`（exit code 127）

### 现象

- **`build` job** 中 **`npm run build`** 失败；日志类似：
  - `> vite build`
  - `sh: 1: vite: Permission denied`
  - `Process completed with exit code 127`
- **`deploy` job** 因依赖 `build` 而未执行或跳过。

### 原因

- **`web/node_modules` 曾被提交进 Git**（在 Windows 下执行 `npm install` 后整体入库）。
- Actions 在 **Ubuntu** 上 `checkout` 后，仓库里的 `node_modules/.bin/vite` 等脚本 **未带 Linux 可执行权限**（或 Windows 侧生成的 shim 在 Unix 上行为异常），导致 shell 无法执行 `vite`。

### 处理

1. 在仓库根目录添加 **`.gitignore`**，忽略 `web/node_modules/`、`web/dist/`、`web/.env` 等。
2. 从 Git **索引**中移除已跟踪的依赖目录（**不删本机文件夹**）：

   ```bash
   git rm -r --cached web/node_modules
   ```

3. 提交并推送；CI 上 **`npm install` 会在 Linux 上重新安装**，生成的 `.bin` 权限正确，`vite build` 可正常运行。

### 预防

- **不要**将 `node_modules` 提交到仓库；仅提交 `package.json` / `package-lock.json`，由 CI 与本机各自 `npm install`。

---

## 问题三：`VITE_SUPABASE_URL` 误配（控制台 404、线上注册/登录异常）

### 现象

- 浏览器 **控制台（Console）** 或 **网络（Network）** 中出现对 **`*.supabase.co`** 请求的 **404**，URL 里还能看到 **`/Stock-trading`**（或仓库子路径）等不该出现在 Supabase 域名后的片段。
- 线上 **邮箱注册** 报错（例如 **`Invalid path specified in request URL`** 等），或与 Auth 相关的请求明显不正常。
- 本地若 `.env` 里同样写错，本地也会出现类似问题。

### 原因

- **GitHub Actions Secret**（或本地 `web/.env`）里的 **`VITE_SUPABASE_URL` 必须是 Supabase 控制台里的「纯 Project URL」**，形态为：
  - `https://<project-ref>.supabase.co`
- **常见误操作**：把 **GitHub Pages 子路径**拼进了 Supabase 地址，例如：
  - `https://xxx.supabase.co/Stock-trading` ❌  
  - `https://xxx.supabase.co/Stock-trading/` ❌  
  - 或任意 **`/auth/v1`、`/rest/v1` 等后缀** ❌（SDK 会自动拼接这些路径）。
- 子路径部署只影响 **静态资源前缀**，由 **`VITE_BASE`**（如 `/Stock-trading/`）单独配置，**与 Supabase URL 无关**。

### 处理

1. 打开 Supabase：**Project Settings → API**，复制 **Project URL**（仅此一行，无尾部路径）。
2. 在 GitHub：**Settings → Secrets and variables → Actions** 中，将 **`VITE_SUPABASE_URL`** 设为上述地址；确认 **没有**多出来的仓库名或 API 路径。
3. 子路径站点另设 Secret：**`VITE_BASE=/Stock-trading/`**（前后斜杠与仓库名一致，以实际仓库名为准）。
4. 修改 Secret 后**必须重新跑一次**「Deploy to GitHub Pages」工作流（或 push 触发部署），前端打包才会带上正确变量。

### 预防

- 文档与 checklist 中区分清楚：**`VITE_SUPABASE_URL` = 仅项目根 URL**；**`VITE_BASE` = Pages 子路径**（如 `/仓库名/`）。

---

## 健康检查清单（部署前）

| 检查项             | 说明                                                           |
| ------------------ | -------------------------------------------------------------- |
| `pages.yml` 编码   | UTF-8（无 BOM）                                                |
| 仓库根 `.gitignore` | 已忽略 `web/node_modules`、`web/dist`、`.env`                  |
| GitHub Secrets     | **`VITE_SUPABASE_URL`**：仅 `https://<ref>.supabase.co`；**`VITE_SUPABASE_ANON_KEY`**；子路径另设 **`VITE_BASE`**（如 `/Stock-trading/`），勿拼进 Supabase URL |
| Pages Source       | **GitHub Actions**（非 Deploy from a branch）                   |
| Supabase Auth      | Redirect URLs 含线上 Pages 地址                                |

---

## 相关文件

- 工作流：`.github/workflows/pages.yml`
- 忽略规则：`.gitignore`
- 编码规则：`.cursor/rules/github-workflows-encoding.mdc`
- 上线总览：根目录 `README.md`（GitHub Pages 与上线顺序）
