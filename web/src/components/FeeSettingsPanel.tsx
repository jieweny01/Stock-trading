import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { defaultFeeParams, type FeeParams, type Market } from '../lib/fees'

const MANUAL_PARAM_KEYS: (keyof FeeParams)[] = [
  'commissionBps',
  'minCommission',
  'stampDutySellBps',
  'transferFeeBps',
  'levyBps',
]

const KEY_LABEL: Partial<Record<keyof FeeParams, string>> = {
  commissionBps: '佣金 bps',
  minCommission: '最低佣',
  stampDutySellBps: '印花税(卖) bps',
  transferFeeBps: '过户 bps',
  levyBps: '徵费 bps',
}

export function FeeSettingsPanel({
  supabase,
  portfolioId,
}: {
  supabase: SupabaseClient
  portfolioId: string | null
}) {
  const [market, setMarket] = useState<Market>('CN_A')
  const [p, setP] = useState<FeeParams>(defaultFeeParams.CN_A)

  useEffect(() => {
    setP(defaultFeeParams[market])
    void (async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u.user) return
      let q = supabase
        .from('fee_settings')
        .select('params')
        .eq('user_id', u.user.id)
        .eq('market', market)
      q = portfolioId ? q.eq('portfolio_id', portfolioId) : q.is('portfolio_id', null)
      const { data } = await q.maybeSingle()
      const merged = { ...defaultFeeParams[market], ...(data?.params as FeeParams) }
      setP(merged)
    })()
  }, [supabase, market, portfolioId])

  async function save() {
    const { data: u } = await supabase.auth.getUser()
    if (!u.user) return
    let del = supabase
      .from('fee_settings')
      .delete()
      .eq('user_id', u.user.id)
      .eq('market', market)
    del = portfolioId ? del.eq('portfolio_id', portfolioId) : del.is('portfolio_id', null)
    await del

    const { error } = await supabase.from('fee_settings').insert({
      user_id: u.user.id,
      portfolio_id: portfolioId,
      market,
      params: p as unknown as Record<string, unknown>,
    })
    alert(error ? error.message : '已保存')
  }

  const field = (k: keyof FeeParams) => (
    <label key={k}>
      {KEY_LABEL[k] ?? k}
      <input
        type="number"
        step="any"
        value={p[k] as number}
        onChange={(e) =>
          setP({ ...p, [k]: Number(e.target.value) } as FeeParams)
        }
      />
    </label>
  )

  return (
    <div className="card">
      <h2>费模型参数（估算用）</h2>
      <select value={market} onChange={(e) => setMarket(e.target.value as Market)}>
        <option value="CN_A">A 股</option>
        <option value="HK">港股</option>
      </select>
      <p className="muted">
        Bps＝万分之一×100（2.5 即 0.025%）。佣金/印花税/过户/徵费 bps
        会在你保存带实付分项的流水后，随校准一并用中位数反推（同类至少约 3
        笔才更新）；最低佣仍建议手调。校准系数 {p.calibrationScale ?? 1}{' '}
        用于吸收剩余整体偏差。
      </p>
      <div className="row">{MANUAL_PARAM_KEYS.map((k) => field(k))}</div>
      <button type="button" onClick={() => void save()}>
        保存
      </button>
    </div>
  )
}
