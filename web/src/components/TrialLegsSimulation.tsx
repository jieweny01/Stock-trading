import { useEffect, useMemo, useState } from 'react'
import type { FeeParams, Market } from '../lib/fees'
import {
  simulateSequentialLegs,
  type SimLegInput,
} from '../lib/tradeSimulation'

type Row = {
  id: string
  side: 'buy' | 'sell'
  qty: string
  price: string
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function buildLegs(
  rows: Row[],
):
  | { ok: true; legs: SimLegInput[] }
  | { ok: false; reason: 'empty' | 'invalid' } {
  const out: SimLegInput[] = []
  for (const r of rows) {
    const empty = !r.qty.trim() && !r.price.trim()
    if (empty) continue
    const q = Number(r.qty)
    const p = Number(r.price)
    if (!q || q <= 0 || p < 0 || !Number.isFinite(q) || !Number.isFinite(p)) {
      return { ok: false, reason: 'invalid' }
    }
    out.push({ side: r.side, quantity: q, price: p })
  }
  if (out.length === 0) return { ok: false, reason: 'empty' }
  return { ok: true, legs: out }
}

export function TrialLegsSimulation({
  defaultMarket,
  feeByMkt,
}: {
  defaultMarket: Market
  feeByMkt: Record<Market, FeeParams>
}) {
  const [market, setMarket] = useState<Market>(defaultMarket)
  const [rows, setRows] = useState<Row[]>([
    { id: uid(), side: 'buy', qty: '', price: '' },
    { id: uid(), side: 'sell', qty: '', price: '' },
  ])

  useEffect(() => {
    setMarket(defaultMarket)
  }, [defaultMarket])

  const legState = useMemo(() => buildLegs(rows), [rows])
  const summary = useMemo(() => {
    if (!legState.ok) return null
    return simulateSequentialLegs(legState.legs, market, feeByMkt[market])
  }, [legState, market, feeByMkt])

  return (
    <div className="holdings-trial-section trial-sim">
      <h3 className="holdings-trial-h3">多笔成交模拟</h3>
      <p className="muted" style={{ marginTop: '-0.15rem' }}>
        按<strong>顺序</strong>逐笔模拟买/卖，税费按「费参数」与所选市场估算；实现盈亏与流水
        <strong>摊薄成本法</strong>一致。空行可保留；有填写的行须为有效数量/价格。
      </p>
      <div className="row" style={{ marginTop: 8 }}>
        <label>
          市场
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as Market)}
          >
            <option value="CN_A">A 股</option>
            <option value="HK">港股</option>
          </select>
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setRows((r) => [...r, { id: uid(), side: 'buy', qty: '', price: '' }])
          }
        >
          加一笔
        </button>
      </div>

      <div className="trial-sim-table-wrap" style={{ marginTop: 10 }}>
        <table className="trial-sim-table">
          <thead>
            <tr>
              <th>#</th>
              <th>方向</th>
              <th>数量</th>
              <th>价格</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>
                  <select
                    value={r.side}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) =>
                          x.id === r.id
                            ? { ...x, side: e.target.value as 'buy' | 'sell' }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="buy">买入</option>
                    <option value="sell">卖出</option>
                  </select>
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    className="trial-sim-input"
                    value={r.qty}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) =>
                          x.id === r.id ? { ...x, qty: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="股数"
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    className="trial-sim-input"
                    value={r.price}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) =>
                          x.id === r.id ? { ...x, price: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="单价"
                  />
                </td>
                <td>
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: '0.25rem 0.45rem' }}
                      onClick={() =>
                        setRows((prev) => prev.filter((x) => x.id !== r.id))
                      }
                    >
                      删
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!legState.ok && legState.reason === 'empty' ? (
        <p className="muted" style={{ marginTop: 8 }}>
          至少填写一笔完整的数量与价格后显示推演结果。
        </p>
      ) : !legState.ok ? (
        <p className="error" style={{ marginTop: 8 }}>
          已填写的行中存在无效数量或价格，请修正。
        </p>
      ) : summary?.error ? (
        <p className="error" style={{ marginTop: 8 }}>
          {summary.error}
        </p>
      ) : summary ? (
        <>
          <div className="trial-sim-table-wrap" style={{ marginTop: 12 }}>
            <table className="trial-sim-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>方向</th>
                  <th>成交额</th>
                  <th>预估税费</th>
                  <th>现金流</th>
                  <th>本腿盈亏</th>
                </tr>
              </thead>
              <tbody>
                {summary.results.map((res, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{res.side === 'buy' ? '买入' : '卖出'}</td>
                    <td>{res.gross.toFixed(2)}</td>
                    <td>{res.feeTotal.toFixed(2)}</td>
                    <td>{res.cashFlow.toFixed(2)}</td>
                    <td>
                      {res.realizedPnlLeg != null ? (
                        <span
                          className={
                            res.realizedPnlLeg >= 0 ? 'pnl-up' : 'pnl-down'
                          }
                        >
                          {res.realizedPnlLeg.toFixed(2)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="trial-sim-totals" style={{ marginTop: 10 }}>
            <p>
              预估税费合计：<strong>{summary.totalFees.toFixed(2)}</strong>
              {' · '}
              净现金流（实收−实付）：{' '}
              <strong>{summary.netCash.toFixed(2)}</strong>
              {' · '}
              累计实现盈亏：{' '}
              <span
                className={
                  summary.totalRealized >= 0 ? 'pnl-up' : 'pnl-down'
                }
              >
                <strong>{summary.totalRealized.toFixed(2)}</strong>
              </span>
            </p>
            <p className="muted" style={{ marginTop: 4 }}>
              模拟结束后持仓 {summary.finalQty.toFixed(4)} 股，剩余成本{' '}
              {summary.finalCostRemaining.toFixed(2)}
              {summary.breakevenPx != null && (
                <>
                  {' '}
                  · 保本名义价约{' '}
                  <strong>{summary.breakevenPx.toFixed(4)}</strong> 元/股
                </>
              )}
              。
            </p>
          </div>
        </>
      ) : null}
    </div>
  )
}
