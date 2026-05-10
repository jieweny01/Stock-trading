import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from './lib/supabase'
import { AuthPanel } from './components/AuthPanel'
import { TradesPanel } from './components/TradesPanel'
import { HoldingsPanel } from './components/HoldingsPanel'
import { FeeSettingsPanel } from './components/FeeSettingsPanel'
import { LedgerPanel } from './components/LedgerPanel'
import { ImportPanel } from './components/ImportPanel'

export type TabId =
  | 'auth'
  | 'trades'
  | 'holdings'
  | 'fees'
  | 'ledger'
  | 'import'

export async function ensurePortfolioId(
  s: SupabaseClient,
): Promise<string | null> {
  const { data: u } = await s.auth.getUser()
  if (!u.user) return null
  const { data: row } = await s.from('portfolios').select('id').limit(1).maybeSingle()
  if (row?.id) return row.id
  const { data: ins, error } = await s
    .from('portfolios')
    .insert({ user_id: u.user.id, name: '默认组合' })
    .select('id')
    .single()
  if (error) throw error
  return ins.id
}

export default function App() {
  const [supabase] = useState(() => {
    try {
      return getSupabase()
    } catch {
      return null as unknown as SupabaseClient
    }
  })
  const [tab, setTab] = useState<TabId>('auth')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [portfolioId, setPortfolioId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const refreshAuth = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.auth.getSession()
    const em = data.session?.user.email ?? null
    setUserEmail(em)
    if (em) {
      const pid = await ensurePortfolioId(supabase)
      setPortfolioId(pid)
    } else setPortfolioId(null)
  }, [supabase])

  useEffect(() => {
    void refreshAuth()
    if (!supabase) return
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refreshAuth()
    })
    return () => sub.subscription.unsubscribe()
  }, [supabase, refreshAuth])

  if (!supabase) {
    return (
      <div className="app">
        <div className="card error">
          请在 web/.env 填写 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY 后运行 npm run dev。
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <h1>股票记账 Phase 1</h1>
      <p className="muted">
        费模型为估算；持仓成本含买入侧实付，浮动盈亏在手输现价上另扣预估卖出费。
      </p>
      {msg && (
        <p className={msg.startsWith('ok:') ? 'ok' : 'error'}>
          {msg.replace(/^ok:\s*/, '')}
        </p>
      )}
      <div className="tabs">
        {(
          [
            ['auth', '登录'],
            ['trades', '流水'],
            ['holdings', '持仓'],
            ['fees', '费参数'],
            ['ledger', '户级'],
            ['import', 'CSV'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={id !== 'auth' && !userEmail}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'auth' && (
        <AuthPanel
          supabase={supabase}
          userEmail={userEmail}
          onMessage={setMsg}
          onDone={refreshAuth}
        />
      )}
      {tab === 'trades' && portfolioId && (
        <TradesPanel
          supabase={supabase}
          portfolioId={portfolioId}
          onMessage={setMsg}
        />
      )}
      {tab === 'holdings' && portfolioId && (
        <HoldingsPanel
          supabase={supabase}
          portfolioId={portfolioId}
          onMessage={setMsg}
        />
      )}
      {tab === 'fees' && (
        <FeeSettingsPanel supabase={supabase} portfolioId={portfolioId} />
      )}
      {tab === 'ledger' && portfolioId && (
        <LedgerPanel
          supabase={supabase}
          portfolioId={portfolioId}
          onMessage={setMsg}
        />
      )}
      {tab === 'import' && portfolioId && (
        <ImportPanel
          supabase={supabase}
          portfolioId={portfolioId}
          onMessage={setMsg}
        />
      )}
    </div>
  )
}
