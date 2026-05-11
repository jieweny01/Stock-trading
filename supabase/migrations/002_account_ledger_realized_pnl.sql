-- 户级快照：记录单笔/本期已实现盈亏（卖出成交后可自动写入），用于汇总图
alter table public.account_ledger_snapshot
  add column if not exists period_realized_pnl numeric(28, 8);

comment on column public.account_ledger_snapshot.period_realized_pnl is
  '已实现盈亏（估算），与摊薄成本法一致；流水卖出成功时可自动记入';
