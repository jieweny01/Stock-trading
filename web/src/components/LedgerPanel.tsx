import type { SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState } from 'react'

type LedgerRow = {
  id: string
  as_of_date: string
  period_realized_pnl: number | null
  period_note: string | null
  created_at: string
}

function LedgerRealizedChart({ series }: { series: { pnl: number; label: string }[] }) {
  if (series.length === 0) {
    return (
      <p className="muted" style={{ marginTop: 8 }}>
        暂无带「本期盈亏」的户级记录；卖出流水成功保存后会自动写入一条。
      </p>
    )
  }

  const W = Math.min(640, series.length * 48 + 80)
  const H = 200
  const padL = 36
  const padR = 12
  const padT = 14
  const padB = 40
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const maxAbs = Math.max(
    1e-6,
    ...series.map((s) => Math.abs(s.pnl)),
  )
  const maxP = maxAbs
  const minP = -maxAbs
  const span = maxP - minP || 1
  const barGap = 4
  const barW = Math.max(
    8,
    (plotW - barGap * (series.length + 1)) / series.length,
  )
  const y0 = padT + plotH * (maxP / span)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="holdings-track-chart"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="户级已实现盈亏"
    >
      <rect
        x={padL}
        y={padT}
        width={plotW}
        height={plotH}
        fill="rgba(212, 175, 55, 0.06)"
        stroke="rgba(212, 175, 55, 0.2)"
      />
      <line
        x1={padL}
        x2={padL + plotW}
        y1={y0}
        y2={y0}
        stroke="#6b6660"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      {series.map((s, i) => {
        const x = padL + barGap + i * (barW + barGap)
        const pos = s.pnl >= 0
        const h = (Math.abs(s.pnl) / span) * plotH
        const y = pos ? y0 - h : y0
        const fill = pos ? '#c45c5c' : '#5a9a5a'
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, 1.5)}
              fill={fill}
              opacity={0.9}
              rx={2}
            />
            <text
              x={x + barW / 2}
              y={H - 6}
              fill="#9b9893"
              fontSize="9"
              textAnchor="middle"
            >
              {s.label}
            </text>
          </g>
        )
      })}
      <text x={4} y={padT + 10} fill="#9b9893" fontSize="10">
        {maxP.toFixed(0)}
      </text>
      <text x={4} y={padT + plotH} fill="#9b9893" fontSize="10">
        {minP.toFixed(0)}
      </text>
      <g transform={`translate(${padL + 4}, ${padT + plotH + 2})`}>
        <rect x="0" y="-8" width="12" height="8" fill="#c45c5c" opacity={0.85} rx={1} />
        <text x="16" y="-1" fill="#9b9893" fontSize="10">
          盈利
        </text>
        <rect x="58" y="-8" width="12" height="8" fill="#5a9a5a" opacity={0.85} rx={1} />
        <text x="74" y="-1" fill="#9b9893" fontSize="10">
          亏损
        </text>
      </g>
    </svg>
  )
}

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
  const [periodPnl, setPeriodPnl] = useState('')
  const [note, setNote] = useState('')
  const [sumEst, setSumEst] = useState<number | null>(null)
  const [history, setHistory] = useState<LedgerRow[]>([])

  const reloadHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from('account_ledger_snapshot')
      .select('id, as_of_date, period_realized_pnl, period_note, created_at')
      .eq('portfolio_id', portfolioId)
      .order('created_at', { ascending: true })
    if (error) return
    setHistory((data ?? []) as LedgerRow[])
  }, [supabase, portfolioId])

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

  useEffect(() => {
    void reloadHistory()
  }, [reloadHistory])

  const chartSeries = useMemo(() => {
    const rows = history.filter(
      (r) =>
        r.period_realized_pnl != null && Number.isFinite(r.period_realized_pnl),
    )
    return rows.map((r) => ({
      pnl: Number(r.period_realized_pnl),
      label: r.as_of_date.slice(5).replace('-', '/'),
    }))
  }, [history])

  const cumSeries = useMemo(() => {
    let s = 0
    return chartSeries.map((x) => {
      s += x.pnl
      return { ...x, cum: s }
    })
  }, [chartSeries])

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
      period_realized_pnl: periodPnl.trim() ? Number(periodPnl) : null,
      period_note: note || null,
    })
    if (error) onMessage(error.message)
    else {
      onMessage('ok: 户级汇总已保存')
      void reloadHistory()
    }
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

      <div className="holdings-trial-section" style={{ marginTop: 12 }}>
        <h3 className="holdings-trial-h3">已实现盈亏（自动 + 手填）</h3>
        <p className="muted" style={{ marginTop: '-0.15rem' }}>
          每成功保存一笔<strong>卖出</strong>流水，会按摊薄成本与估算费写入一条户级记录（字段
          <strong>本期盈亏</strong>）。亦可在此手填汇总。
        </p>
        <LedgerRealizedChart series={chartSeries} />
        {cumSeries.length > 0 && (
          <p className="muted" style={{ marginTop: 8 }}>
            累计已实现（按记录顺序）：{' '}
            <strong
              className={
                cumSeries[cumSeries.length - 1].cum >= 0 ? 'pnl-up' : 'pnl-down'
              }
            >
              {cumSeries[cumSeries.length - 1].cum.toFixed(2)}
            </strong>
          </p>
        )}
        {history.length > 0 && (
          <div className="trial-sim-table-wrap" style={{ marginTop: 10 }}>
            <table className="trial-sim-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>本期盈亏</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {history
                  .slice()
                  .reverse()
                  .slice(0, 12)
                  .map((r) => (
                    <tr key={r.id}>
                      <td>{r.as_of_date}</td>
                      <td>
                        {r.period_realized_pnl != null ? (
                          <span
                            className={
                              r.period_realized_pnl >= 0 ? 'pnl-up' : 'pnl-down'
                            }
                          >
                            {Number(r.period_realized_pnl).toFixed(2)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: '0.82rem' }}>
                        {r.period_note ?? ''}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 6 }}>
              上表仅列最近 12 条（倒序）；柱图包含全部带盈亏数值的记录。
            </p>
          </div>
        )}
      </div>

      <div className="row" style={{ marginTop: 14 }}>
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
        <label>
          本期盈亏（可选）
          <input
            inputMode="decimal"
            value={periodPnl}
            onChange={(e) => setPeriodPnl(e.target.value)}
            placeholder="手填已实现盈亏"
          />
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
