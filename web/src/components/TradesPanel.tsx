import type { SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import type { Trade } from '../lib/holdings'
import {
  defaultFeeParams,
  estimateFees,
  round2,
  type FeeParams,
  type Market,
} from '../lib/fees'
import { fetchMergedFeeParams } from '../lib/feeParamsLoad'
import {
  actualFeesSum,
  runFeeCalibrationForMarket,
} from '../lib/tradeCalibration'

function rowMarket(t: Trade): Market {
  return t.market ?? 'CN_A'
}

function effectiveAmount(
  quantity: string,
  price: string,
  amount: string,
): number {
  const q = Number(quantity)
  const p = Number(price)
  const a = Number(amount)
  if (a > 0) return round2(a)
  if (q > 0 && p > 0) return round2(q * p)
  return 0
}

function tradeHasRecordedFees(t: Trade): boolean {
  return [
    t.fee_commission,
    t.fee_stamp,
    t.fee_transfer,
    t.fee_levy,
    t.fee_other,
  ].some((v) => v != null && Number(v) !== 0)
}

function scaleRecordedFees(
  ref: Trade,
  newAmount: number,
): {
  fee_commission: string
  fee_stamp: string
  fee_transfer: string
  fee_levy: string
  fee_other: string
} {
  const oldAmt = Number(ref.amount)
  const factor = oldAmt > 0 ? newAmount / oldAmt : 1
  const scaled = (v: number | null) =>
    v != null ? String(round2(Number(v) * factor)) : ''
  return {
    fee_commission: scaled(ref.fee_commission),
    fee_stamp: scaled(ref.fee_stamp),
    fee_transfer: scaled(ref.fee_transfer),
    fee_levy: scaled(ref.fee_levy),
    fee_other: scaled(ref.fee_other),
  }
}

function parseFeeStr(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

type FeeCols = {
  fee_commission: number | null
  fee_stamp: number | null
  fee_transfer: number | null
  fee_levy: number | null
  fee_other: number | null
}

function anyFeeFieldFilled(form: {
  fee_commission: string
  fee_stamp: string
  fee_transfer: string
  fee_levy: string
  fee_other: string
}): boolean {
  return [
    form.fee_commission,
    form.fee_stamp,
    form.fee_transfer,
    form.fee_levy,
    form.fee_other,
  ].some((s) => s.trim() !== '')
}

function feesFromFormOnly(form: {
  fee_commission: string
  fee_stamp: string
  fee_transfer: string
  fee_levy: string
  fee_other: string
}): FeeCols {
  return {
    fee_commission: parseFeeStr(form.fee_commission),
    fee_stamp: parseFeeStr(form.fee_stamp),
    fee_transfer: parseFeeStr(form.fee_transfer),
    fee_levy: parseFeeStr(form.fee_levy),
    fee_other: parseFeeStr(form.fee_other),
  }
}

function resolveFeesForSave(
  form: {
    side: 'buy' | 'sell'
    symbol: string
    fee_commission: string
    fee_stamp: string
    fee_transfer: string
    fee_levy: string
    fee_other: string
  },
  rows: Trade[],
  market: Market,
  amount: number,
  feeP: FeeParams,
): FeeCols {
  if (anyFeeFieldFilled(form)) return feesFromFormOnly(form)
  const sym = form.symbol.trim().toUpperCase()
  const reversed = [...rows].reverse()
  let ref = sym
    ? reversed.find(
        (r) =>
          rowMarket(r) === market &&
          r.symbol === sym &&
          tradeHasRecordedFees(r),
      )
    : undefined
  if (!ref)
    ref = reversed.find(
      (r) => rowMarket(r) === market && tradeHasRecordedFees(r),
    )
  if (ref) {
    const sc = scaleRecordedFees(ref, amount)
    return {
      fee_commission: parseFeeStr(sc.fee_commission),
      fee_stamp: parseFeeStr(sc.fee_stamp),
      fee_transfer: parseFeeStr(sc.fee_transfer),
      fee_levy: parseFeeStr(sc.fee_levy),
      fee_other: parseFeeStr(sc.fee_other),
    }
  }
  const est = estimateFees(form.side, amount, market, feeP)
  return {
    fee_commission: est.commission,
    fee_stamp: est.stamp,
    fee_transfer: est.transfer,
    fee_levy: est.levy,
    fee_other: null,
  }
}

function feeColsToFormFields(c: FeeCols) {
  return {
    fee_commission: c.fee_commission != null ? String(c.fee_commission) : '',
    fee_stamp: c.fee_stamp != null ? String(c.fee_stamp) : '',
    fee_transfer: c.fee_transfer != null ? String(c.fee_transfer) : '',
    fee_levy: c.fee_levy != null ? String(c.fee_levy) : '',
    fee_other: c.fee_other != null ? String(c.fee_other) : '',
  }
}

/** 行内编辑草稿（字符串表单，与新流水一致） */
type EditDraft = {
  market: Market
  side: 'buy' | 'sell'
  symbol: string
  quantity: string
  price: string
  amount: string
  trade_date: string
  settlement_date: string
  fee_commission: string
  fee_stamp: string
  fee_transfer: string
  fee_levy: string
  fee_other: string
  notes: string
}

function tradeToDraft(r: Trade): EditDraft {
  const n = (v: number | null | undefined) =>
    v != null && Number.isFinite(Number(v)) ? String(v) : ''
  return {
    market: rowMarket(r),
    side: r.side,
    symbol: r.symbol,
    quantity: n(r.quantity) || String(r.quantity),
    price: n(r.price) || String(r.price),
    amount: n(r.amount) || String(r.amount),
    trade_date: r.trade_date,
    settlement_date: r.settlement_date ?? '',
    fee_commission: n(r.fee_commission),
    fee_stamp: n(r.fee_stamp),
    fee_transfer: n(r.fee_transfer),
    fee_levy: n(r.fee_levy),
    fee_other: n(r.fee_other),
    notes: r.notes ?? '',
  }
}

function cmpTradeRow(a: Trade, b: Trade): number {
  if (a.trade_date !== b.trade_date)
    return a.trade_date < b.trade_date ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

type TradeGroup = {
  symbol: string
  trades: Trade[]
  buyAmt: number
  sellAmt: number
  buyQty: number
  sellQty: number
  netQty: number
  paidFeesSum: number
  marketLabel: string
}

function buildTradeGroups(rows: Trade[]): TradeGroup[] {
  const m = new Map<string, Trade[]>()
  for (const r of rows) {
    const sym = r.symbol.trim().toUpperCase() || '—'
    if (!m.has(sym)) m.set(sym, [])
    m.get(sym)!.push(r)
  }
  const out: TradeGroup[] = []
  for (const [symbol, raw] of m) {
    const trades = [...raw].sort(cmpTradeRow)
    let buyAmt = 0
    let sellAmt = 0
    let buyQty = 0
    let sellQty = 0
    let paidFeesSum = 0
    const markets = new Set<Market>()
    for (const t of trades) {
      const amt = Number(t.amount)
      const q = Number(t.quantity)
      markets.add(rowMarket(t))
      paidFeesSum += actualFeesSum(t)
      if (t.side === 'buy') {
        buyAmt += amt
        buyQty += q
      } else {
        sellAmt += amt
        sellQty += q
      }
    }
    let marketLabel = 'A'
    if (markets.size > 1) marketLabel = 'A+港'
    else if (markets.has('HK')) marketLabel = '港'
    out.push({
      symbol,
      trades,
      buyAmt: round2(buyAmt),
      sellAmt: round2(sellAmt),
      buyQty,
      sellQty,
      netQty: round2(buyQty - sellQty),
      paidFeesSum: round2(paidFeesSum),
      marketLabel,
    })
  }
  out.sort((a, b) => a.symbol.localeCompare(b.symbol, 'en'))
  return out
}

export function TradesPanel({
  supabase,
  portfolioId,
  onMessage,
}: {
  supabase: SupabaseClient
  portfolioId: string
  onMessage: (s: string) => void
}) {
  const [rows, setRows] = useState<Trade[]>([])
  const [market, setMarket] = useState<Market>('CN_A')
  const [feeByMkt, setFeeByMkt] = useState<Record<Market, FeeParams>>({
    CN_A: defaultFeeParams.CN_A,
    HK: defaultFeeParams.HK,
  })

  const feeP = feeByMkt[market]

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('trades')
      .select(
        'id, side, symbol, quantity, price, amount, trade_date, settlement_date, market, fee_commission, fee_stamp, fee_transfer, fee_levy, fee_other, fee_estimated_total, notes',
      )
      .eq('portfolio_id', portfolioId)
      .order('trade_date', { ascending: true })
    if (error) onMessage(error.message)
    else setRows((data ?? []) as Trade[])
  }, [supabase, portfolioId, onMessage])

  /** A+H 各一套，列表里混市场时每行用对应参数算「当前模型」 */
  const loadFeeBothMarkets = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser()
    if (!u.user) return
    const [cn, hk] = await Promise.all([
      fetchMergedFeeParams(supabase, u.user.id, portfolioId, 'CN_A'),
      fetchMergedFeeParams(supabase, u.user.id, portfolioId, 'HK'),
    ])
    setFeeByMkt({ CN_A: cn, HK: hk })
  }, [supabase, portfolioId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadFeeBothMarkets()
  }, [loadFeeBothMarkets])

  const [form, setForm] = useState({
    side: 'buy' as 'buy' | 'sell',
    symbol: '',
    quantity: '',
    price: '',
    amount: '',
    trade_date: new Date().toISOString().slice(0, 10),
    settlement_date: '',
    fee_commission: '',
    fee_stamp: '',
    fee_transfer: '',
    fee_levy: '',
    fee_other: '',
    notes: '',
  })

  const [groupBySymbol, setGroupBySymbol] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)

  const amtPreview = useMemo(
    () => effectiveAmount(form.quantity, form.price, form.amount),
    [form.quantity, form.price, form.amount],
  )

  const estPreview = useMemo(() => {
    if (amtPreview <= 0) return null
    return estimateFees(form.side, amtPreview, market, feeP)
  }, [amtPreview, form.side, market, feeP])

  const editAmtPreview = useMemo(() => {
    if (!editDraft) return 0
    return effectiveAmount(editDraft.quantity, editDraft.price, editDraft.amount)
  }, [editDraft])

  const editEstPreview = useMemo(() => {
    if (!editDraft || editAmtPreview <= 0) return null
    return estimateFees(
      editDraft.side,
      editAmtPreview,
      editDraft.market,
      feeByMkt[editDraft.market],
    )
  }, [editDraft, editAmtPreview, feeByMkt])

  const tradeGroups = useMemo(() => buildTradeGroups(rows), [rows])

  async function addTrade() {
    const qty = Number(form.quantity)
    const price = Number(form.price)
    let amount = Number(form.amount)
    if (!amount && qty && price) amount = Math.round(qty * price * 100) / 100
    if (!form.symbol.trim()) {
      onMessage('请填写代码')
      return
    }
    if (!qty || qty <= 0 || price < 0 || !amount || amount <= 0) {
      onMessage('请检查数量、价格、成交额')
      return
    }

    const resolvedFees = resolveFeesForSave(form, rows, market, amount, feeP)
    if (!anyFeeFieldFilled(form)) {
      setForm((f) => ({ ...f, ...feeColsToFormFields(resolvedFees) }))
    }

    const est = estimateFees(form.side, amount, market, feeP)
    const { error } = await supabase.from('trades').insert({
      portfolio_id: portfolioId,
      market,
      side: form.side,
      symbol: form.symbol.trim().toUpperCase(),
      quantity: qty,
      price,
      amount,
      trade_date: form.trade_date,
      settlement_date: form.settlement_date || null,
      fee_commission: resolvedFees.fee_commission,
      fee_stamp: resolvedFees.fee_stamp,
      fee_transfer: resolvedFees.fee_transfer,
      fee_levy: resolvedFees.fee_levy,
      fee_other: resolvedFees.fee_other,
      fee_estimated_total: est.total,
      fee_estimated_breakdown: est,
      notes: form.notes || null,
    })
    if (error) onMessage(error.message)
    else {
      onMessage('ok: 已保存（有实付分项时会更新费校准系数）')
      void load()
      const { data: u } = await supabase.auth.getUser()
      if (u.user) {
        void runFeeCalibrationForMarket(supabase, {
          userId: u.user.id,
          portfolioId,
          market,
        }).then(() => {
          void loadFeeBothMarkets()
        })
      }
    }
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft(null)
  }

  async function saveEdit() {
    if (!editingId || !editDraft) return
    const qty = Number(editDraft.quantity)
    const price = Number(editDraft.price)
    let amount = Number(editDraft.amount)
    if (!amount && qty && price) amount = Math.round(qty * price * 100) / 100
    if (!editDraft.symbol.trim()) {
      onMessage('请填写代码')
      return
    }
    if (!qty || qty <= 0 || price < 0 || !amount || amount <= 0) {
      onMessage('请检查数量、价格、成交额')
      return
    }

    const peerRows = rows.filter((x) => x.id !== editingId)
    const resolvedFees = resolveFeesForSave(
      {
        side: editDraft.side,
        symbol: editDraft.symbol,
        fee_commission: editDraft.fee_commission,
        fee_stamp: editDraft.fee_stamp,
        fee_transfer: editDraft.fee_transfer,
        fee_levy: editDraft.fee_levy,
        fee_other: editDraft.fee_other,
      },
      peerRows,
      editDraft.market,
      amount,
      feeByMkt[editDraft.market],
    )

    const est = estimateFees(
      editDraft.side,
      amount,
      editDraft.market,
      feeByMkt[editDraft.market],
    )
    const { error } = await supabase
      .from('trades')
      .update({
        market: editDraft.market,
        side: editDraft.side,
        symbol: editDraft.symbol.trim().toUpperCase(),
        quantity: qty,
        price,
        amount,
        trade_date: editDraft.trade_date,
        settlement_date: editDraft.settlement_date || null,
        fee_commission: resolvedFees.fee_commission,
        fee_stamp: resolvedFees.fee_stamp,
        fee_transfer: resolvedFees.fee_transfer,
        fee_levy: resolvedFees.fee_levy,
        fee_other: resolvedFees.fee_other,
        fee_estimated_total: est.total,
        fee_estimated_breakdown: est,
        notes: editDraft.notes || null,
      })
      .eq('id', editingId)
      .eq('portfolio_id', portfolioId)

    if (error) onMessage(error.message)
    else {
      const calMkt = editDraft.market
      onMessage('ok: 已更新')
      cancelEdit()
      void load()
      const { data: u } = await supabase.auth.getUser()
      if (u.user) {
        void runFeeCalibrationForMarket(supabase, {
          userId: u.user.id,
          portfolioId,
          market: calMkt,
        }).then(() => {
          void loadFeeBothMarkets()
        })
      }
    }
  }

  function renderTradeRow(r: Trade) {
    if (editingId === r.id && editDraft) {
      const d = editDraft
      return (
        <tr key={r.id} className="trade-row-editing">
          <td colSpan={10}>
            <div className="trade-edit-block">
              <div className="row trades-main-row">
                <label>
                  市场
                  <select
                    value={d.market}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, market: e.target.value as Market } : x,
                      )
                    }
                  >
                    <option value="CN_A">A 股</option>
                    <option value="HK">港股</option>
                  </select>
                </label>
                <label>
                  方向
                  <select
                    value={d.side}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x
                          ? { ...x, side: e.target.value as 'buy' | 'sell' }
                          : x,
                      )
                    }
                  >
                    <option value="buy">买</option>
                    <option value="sell">卖</option>
                  </select>
                </label>
                <label>
                  代码
                  <input
                    value={d.symbol}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, symbol: e.target.value } : x,
                      )
                    }
                  />
                </label>
                <label>
                  数量
                  <input
                    inputMode="decimal"
                    value={d.quantity}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, quantity: e.target.value } : x,
                      )
                    }
                  />
                </label>
                <label>
                  价格
                  <input
                    inputMode="decimal"
                    value={d.price}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, price: e.target.value } : x,
                      )
                    }
                  />
                </label>
                <label>
                  成交额
                  <input
                    inputMode="decimal"
                    placeholder="可空按量×价"
                    value={d.amount}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, amount: e.target.value } : x,
                      )
                    }
                  />
                </label>
                <label>
                  成交日
                  <input
                    type="date"
                    value={d.trade_date}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, trade_date: e.target.value } : x,
                      )
                    }
                  />
                </label>
                <label>
                  结算日
                  <input
                    type="date"
                    value={d.settlement_date}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, settlement_date: e.target.value } : x,
                      )
                    }
                  />
                </label>
              </div>
              <div className="row trades-main-row" style={{ marginTop: 6 }}>
                <label>
                  佣金
                  <input
                    inputMode="decimal"
                    value={d.fee_commission}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, fee_commission: e.target.value } : x,
                      )
                    }
                  />
                </label>
                <label>
                  印花税
                  <input
                    inputMode="decimal"
                    value={d.fee_stamp}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, fee_stamp: e.target.value } : x,
                      )
                    }
                  />
                </label>
                <label>
                  过户
                  <input
                    inputMode="decimal"
                    value={d.fee_transfer}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, fee_transfer: e.target.value } : x,
                      )
                    }
                  />
                </label>
                <label>
                  徵费
                  <input
                    inputMode="decimal"
                    value={d.fee_levy}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, fee_levy: e.target.value } : x,
                      )
                    }
                  />
                </label>
                <label>
                  其他
                  <input
                    inputMode="decimal"
                    value={d.fee_other}
                    onChange={(e) =>
                      setEditDraft((x) =>
                        x ? { ...x, fee_other: e.target.value } : x,
                      )
                    }
                  />
                </label>
              </div>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  marginTop: 8,
                  maxWidth: '36rem',
                }}
              >
                备注
                <input
                  value={d.notes}
                  onChange={(e) =>
                    setEditDraft((x) =>
                      x ? { ...x, notes: e.target.value } : x,
                    )
                  }
                />
              </label>
              <div
                className="row"
                style={{ alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}
              >
                {editEstPreview && (
                  <span
                    className="muted"
                    title={`佣 ${editEstPreview.commission} · 印 ${editEstPreview.stamp} · 过 ${editEstPreview.transfer} · 徵 ${editEstPreview.levy}`}
                  >
                    保存时将写入模型费 <strong>{editEstPreview.total}</strong>
                  </span>
                )}
                <button type="button" onClick={() => void saveEdit()}>
                  保存修改
                </button>
                <button type="button" className="secondary" onClick={cancelEdit}>
                  取消
                </button>
              </div>
            </div>
          </td>
        </tr>
      )
    }

    const paid = actualFeesSum(r)
    const amt = Number(r.amount)
    const mkt = rowMarket(r)
    const modelLive =
      amt > 0 ? estimateFees(r.side, amt, mkt, feeByMkt[mkt]) : null
    const modelTotal = modelLive ? modelLive.total : null
    const modelTitle = modelLive
      ? `佣 ${modelLive.commission} · 印 ${modelLive.stamp} · 过 ${modelLive.transfer} · 徵 ${modelLive.levy}`
      : undefined
    return (
      <tr key={r.id}>
        <td>{r.trade_date}</td>
        <td>{mkt === 'HK' ? '港' : 'A'}</td>
        <td>{r.side === 'buy' ? '买' : '卖'}</td>
        <td>{r.symbol}</td>
        <td>{r.quantity}</td>
        <td>{r.price}</td>
        <td>{r.amount}</td>
        <td>{paid > 0 ? paid : '—'}</td>
        <td title={modelTitle}>{modelTotal != null ? modelTotal : '—'}</td>
        <td>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setEditingId(r.id)
              setEditDraft(tradeToDraft(r))
            }}
          >
            改
          </button>{' '}
          <button
            type="button"
            className="danger"
            onClick={() => void remove(r.id)}
          >
            删
          </button>
        </td>
      </tr>
    )
  }

  async function remove(id: string) {
    if (!confirm('删除该流水？')) return
    if (id === editingId) cancelEdit()
    const row = rows.find((r) => r.id === id)
    const calMarket = row ? rowMarket(row) : market
    const { error } = await supabase.from('trades').delete().eq('id', id)
    if (error) onMessage(error.message)
    else {
      void load()
      const { data: u } = await supabase.auth.getUser()
      if (u.user) {
        void runFeeCalibrationForMarket(supabase, {
          userId: u.user.id,
          portfolioId,
          market: calMarket,
        }).then(() => {
          void loadFeeBothMarkets()
        })
      }
    }
  }

  return (
    <div className="trades-panel">
      <div className="card">
        <h2>新流水</h2>
        <p className="muted" style={{ marginTop: '-0.25rem' }}>
          成交额可空。费用全空则自动填（先找同市场同代码已有分项按比例，否则按费参数）。下方列表可点<strong>改</strong>编辑已保存流水；保存时按当前参数重算并写回库内模型费（用于汇总与校准）。「实付」为分项合计，「模型」为按当前费参数估算，悬停可看拆项。
        </p>

        <div className="row trades-main-row">
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
          <label>
            方向
            <select
              value={form.side}
              onChange={(e) =>
                setForm((f) => ({ ...f, side: e.target.value as 'buy' | 'sell' }))
              }
            >
              <option value="buy">买</option>
              <option value="sell">卖</option>
            </select>
          </label>
          <label>
            代码
            <input
              placeholder="如 600000"
              value={form.symbol}
              onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
            />
          </label>
          <label>
            数量
            <input
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            />
          </label>
          <label>
            价格
            <input
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            />
          </label>
          <label>
            成交额
            <input
              inputMode="decimal"
              placeholder="可空"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </label>
          <label>
            成交日
            <input
              type="date"
              value={form.trade_date}
              onChange={(e) =>
                setForm((f) => ({ ...f, trade_date: e.target.value }))
              }
            />
          </label>
        </div>

        {estPreview && (
          <p
            className="muted trades-est-preview"
            style={{ margin: '0.25rem 0 0.5rem' }}
            title={`佣 ${estPreview.commission} · 印 ${estPreview.stamp} · 过户 ${estPreview.transfer} · 徵 ${estPreview.levy}`}
          >
            本笔模型费：<strong>{estPreview.total}</strong>
            <span className="trades-est-sub">
              （佣 {estPreview.commission} / 印 {estPreview.stamp} / 过{' '}
              {estPreview.transfer} / 徵 {estPreview.levy}）
            </span>
          </p>
        )}

        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" onClick={() => void addTrade()}>
            保存
          </button>
        </div>

        <details className="trades-details trades-details-fees">
          <summary>分项（可选）</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <label>
              佣金
              <input
                inputMode="decimal"
                value={form.fee_commission}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fee_commission: e.target.value }))
                }
              />
            </label>
            <label>
              印花税
              <input
                inputMode="decimal"
                value={form.fee_stamp}
                onChange={(e) => setForm((f) => ({ ...f, fee_stamp: e.target.value }))}
              />
            </label>
            <label>
              过户
              <input
                inputMode="decimal"
                value={form.fee_transfer}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fee_transfer: e.target.value }))
                }
              />
            </label>
            <label>
              徵费
              <input
                inputMode="decimal"
                value={form.fee_levy}
                onChange={(e) => setForm((f) => ({ ...f, fee_levy: e.target.value }))}
              />
            </label>
            <label>
              其他
              <input
                inputMode="decimal"
                value={form.fee_other}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fee_other: e.target.value }))
                }
              />
            </label>
          </div>
        </details>

        <details className="trades-details">
          <summary>结算日、备注</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <label>
              结算日
              <input
                type="date"
                value={form.settlement_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, settlement_date: e.target.value }))
                }
              />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            备注
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
        </details>
      </div>

      <div className="card">
        <h2>流水列表</h2>
        <div
          className="row"
          style={{ alignItems: 'center', marginTop: '-0.35rem', marginBottom: '0.35rem' }}
        >
          <label
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={groupBySymbol}
              onChange={(e) => setGroupBySymbol(e.target.checked)}
            />
            按代码分组统计
          </label>
          {groupBySymbol && (
            <span className="muted">
              共 {tradeGroups.length} 个代码；组内按日期排序
            </span>
          )}
        </div>
        <details className="trades-details trades-legend">
          <summary>列表列说明</summary>
          <p className="muted" style={{ margin: '0.5rem 0 0' }}>
            <strong>实付</strong>：本条流水佣/印/过/徵/其他合计。<strong>模型</strong>：按当前费参数+校准对成交额重算，悬停看拆项；改价、改额或调参数后会变化，点「改」保存即可把库内模型费同步为当前公式结果。
          </p>
        </details>
        <div style={{ overflowX: 'auto' }}>
          <table className="trades-table">
            <thead>
              <tr>
                <th>日</th>
                <th>市</th>
                <th>向</th>
                <th>代码</th>
                <th>量</th>
                <th>价</th>
                <th>额</th>
                <th>实付</th>
                <th>模型</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groupBySymbol
                ? tradeGroups.map((g) => (
                    <Fragment key={g.symbol}>
                      <tr className="trades-group-header">
                        <td colSpan={10}>
                          <strong>{g.symbol}</strong>
                          <span className="trades-group-meta">
                            {' '}
                            · 市 {g.marketLabel} · 共 {g.trades.length} 笔 · 买额{' '}
                            {g.buyAmt} · 卖额 {g.sellAmt} · 净数量 {g.netQty} ·
                            实付税费 {g.paidFeesSum}
                          </span>
                        </td>
                      </tr>
                      {g.trades.map((r) => renderTradeRow(r))}
                    </Fragment>
                  ))
                : [...rows].sort(cmpTradeRow).map((r) => renderTradeRow(r))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
