---

name: 股票计算器形态选择
overview: Phase 1：云端流水+快照+摊薄盈亏；Supabase + GitHub Pages（Vite/React）；Phase 1 不购买行情 API。
todos:

- id: data-model-p1
content: 建表 + RLS（portfolios/trades/snapshots/fee_settings 等）
status: completed
- id: ux-p1
content: 流水、快照、持仓、对账等 Phase 1 交互
status: completed
- id: fee-model-p1
content: A/港费规则与户级对账
status: completed
- id: csv-import-later
content: CSV 导入
status: completed
- id: backlog
content: 后续 K 线/回测/组合优化等
status: cancelled
isProject: false

---

本文件为 Phase 1 产品/部署计划，与代码同库存档；**使用 UTF-8 编码保存（无 BOM）**。可自行用 Git 做版本管理。

# 股票交易计算器 · Phase 1（压缩版）

## 目标与范围

浏览器 + 登录 + BaaS 存数据；流水为主数据；费模型估算并与手填/户级汇总对账。

**做**：流水、估值快照、摊薄与浮动盈亏、费规则 v0、快照对账（可强制保存）、CSV 导入等。**不做**：K 线、回测 run、组合优化求解、公司行为专门流程。

## 已定产品规则（摘要）

- 市场 A 股 + 港股；费用分列 + 合计。
- 费两轨：手填实付优先；模型估算辅助。
- 户级汇总进 account_ledger_snapshot，与估算费加总对账。
- 单组合、portfolio_id；快照可强制保存。

## 仓库路径速查

- 前端：`web/`
- SQL：`supabase/migrations/001_initial_schema.sql`
- Pages：`.github/workflows/pages.yml`
- 说明：`web/SETUP.md`

## 开发与上线顺序（推荐）

**先在本地完善，再 GitHub 上线**——不是硬性规定，但最省心、最常见。

1. **本地**：在 `web/` 改代码；`npm run dev` 自测（登录、流水、快照等）；发布前 `npm run build` 确认能通过。
2. **Git**：`commit` 并 push；仓库需含 `web/` 与 `.github/workflows/pages.yml`（目录不一致则改工作流）。
3. **GitHub**：Settings → Pages 选 **GitHub Actions**；Secrets 注入 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；若地址为 `https://<user>.github.io/<repo>/` 子路径，再加 `VITE_BASE`（如 `/<repo>/`）。
4. **Supabase**：拿到 **Pages 真实 URL** 后，在 Authentication → URL Configuration **追加 Redirect URLs**（与 `http://localhost:5173` 一并维护）。

**说明**：可提前建仓库 push 骨架；**真正对外可用**一般等本地满意、构建无报错后再配 Secrets 与部署。

## 现价跟踪 ·「收益范围参考」模型（实现摘记）

以下对应前端 `HoldingsPanel` 内 `trackRangeAdvice` 的**当前**口径，仅作文档镜像；**非投资建议**，产品上属辅助阅读。

### 输入


| 输入      | 来源                                                    |
| ------- | ----------------------------------------------------- |
| 昨收（锚定价） | 手填昨收（本地存，优先）否则取「快照日期早于今天」的最近一条估值快照里该代码的 `input_close` |
| 当前名义价   | 有跟踪点则取**最后一条**点的价格；否则若「记入现价」输入框为有效正数则用之               |
| 历史跟踪点   | 本机 `localStorage` 时间序列，相邻点之间的**名义价**                  |


### 计算步骤（当前版）

1. **相对昨收**：(当前名义价 − 昨收) / 昨收，以百分比展示。
2. **若跟踪点 ≥ 2**：对每一对相邻点 p_{i-1}, p_i（p_{i-1}>0）算逐步收益率 r_i = (p_i - p_{i-1}) / p_{i-1}；再算 \mu = \mathrm{mean}(r_i)、\sigma = \mathrm{std}(r_i)（与代码中样本方差实现一致）。
3. **经验参考带**：以昨收为基准，区间 \text{昨收} \times (1 + \mu \pm 1.5\sigma)，取两端最小/最大保证左 ≤ 右；文案中称「粗估名义价参考带」。
4. **位置判断**：若有当前名义价，判断是否落在上述区间内，生成「带内/带外」一句话（带外表述为与近期记录节奏差异较大）。
5. **同步展示**：该段跟踪窗口内的实际最低价、最高价（名义价）。
6. **若仅 1 个点**：只提示相对昨收涨跌幅，并说明点多后估算更稳。
7. **若无跟踪点**：提示先记入名义价后再看参考带。

### 待优化（备注）

- **统计假设薄弱**：逐步收益率独立同分布、正态近似均未成立；1.5\sigma 系数为拍脑袋，无回测与校准。
- **样本偏差**：跟踪点为用户手动、非均匀采样，不代表真实高频或日频收益分布。
- **锚定误差**：昨收来自快照或手填，与交易所官方昨收可能不一致；未处理除权除息。
- **与波动率模型**：未使用 GARCH、已实现波动率、ATR 等；未结合持仓或费后口径。
- **性能**：快照拉取昨收现为按日倒序循环查询，可改为单次联表/RPC。
- **产品**：需不需要显性免责声明弹窗、是否对机构用户默认关闭该模块等。

## 接下来（checklist）

1. 本地：`cd web`，`.env`，`npm run dev`；上线前 `npm run build`。
2. Supabase：Redirect + Site URL（本地 + 线上）。
3. GitHub：Pages + Secrets + 子路径 `VITE_BASE`。
4. 冒烟：登录后录一笔流水（本地与线上各一遍）。

