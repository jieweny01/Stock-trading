-- trades.market (run in Supabase SQL Editor)
alter table public.trades
  add column if not exists market text default 'CN_A';

comment on column public.trades.market is 'CN_A A-share HK Hong Kong';

update public.trades set market = 'CN_A' where market is null;

alter table public.trades drop constraint if exists trades_market_check;
alter table public.trades
  add constraint trades_market_check
  check (market is null or market in ('CN_A', 'HK'));

create index if not exists trades_portfolio_market_idx
  on public.trades (portfolio_id, market);
