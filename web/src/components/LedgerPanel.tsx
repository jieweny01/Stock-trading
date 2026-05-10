import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

export function LedgerPanel({
  supabase,
  portfolioId,
  onMessage,
}: {
  supabase: SupabaseClient
  portfolioId: string
  onMessage: (s: string) => void
}) {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [invested, setInvested] = useState('')
  const [recovered, setRecovered] = useState('')
  const [feesTotal, setFeesTotal] = useState('')
  const [note, setNote] = useState('')
  const [sumEst, setSumEst] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('trades')
        .select('fee_estimated_total')
        .eq('portfolio_id', portfolioId)
      const s = (data ?? []).reduce(
        (a, r) => a + Number(r.fee_estimated_total || 0),
        0,
      )
      setSumEst(s)
    })()
  }, [supabase, portfolioId])

  async function save() {
    const { data: u } = await supabase.auth.getUser()
    if (!u.user) return
    const { error } = await supabase.from('account_ledger_snapshot').insert({
      portfolio_id: portfolioId,
      user_id: u.user.id,
      as_of_date: asOf,
      invested_total: invested ? Number(invested) : null,
      recovered_total: recovered ? Number(recovered) : null,
      fees_total: feesTotal ? Number(feesTotal) : null,
      period_note: note || null,
    })
    if (error) onMessage(error.message)
    else onMessage('ok: 户级汇总已保存')
  }

  const ft = feesTotal ? Number(feesTotal) : null
  const diff =
    sumEst != null && ft != null && !Number.isNaN(ft) ? sumEst - ft : null

  return (
    <div className="card">
      <h2>户级汇总（对账）</h2>
      <p className="muted">
        当前流水估算费合计（模型加总）：{' '}
        <strong>{sumEst?.toFixed(2) ?? '-'}</strong>
        ；与下方「税费合计」比对。
      </p>
      {diff != null && (
        <p>差值（估算加总 − 户级税费合计）：{diff.toFixed(2)}</p>
      )}
      <div className="row">
        <label>
          截止日
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label>
          投入资金
          <input value={invested} onChange={(e) => setInvested(e.target.value)} />
        </label>
        <label>
          回收资金
          <input value={recovered} onChange={(e) => setRecovered(e.target.value)} />
        </label>
        <label>
          税费合计（户级）
          <input value={feesTotal} onChange={(e) => setFeesTotal(e.target.value)} />
        </label>
      </div>
      <label>
        备注
        <input value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', maxWidth: 480 }} />
      </label>
      <button type="button" style={{ marginTop: 8 }} onClick={() => void save()}>
        保存一条户级快照
      </button>
    </div>
  )
}
