import type { SupabaseClient } from '@supabase/supabase-js'
import { useState } from 'react'
import { defaultFeeParams, estimateFees } from '../lib/fees'
import { runFeeCalibrationForMarket } from '../lib/tradeCalibration'

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') q = !q
    else if ((c === ',' || c === '\t') && !q) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  out.push(cur.trim())
  return out
}

export function ImportPanel({
  supabase,
  portfolioId,
  onMessage,
}: {
  supabase: SupabaseClient
  portfolioId: string
  onMessage: (s: string) => void
}) {
  const [text, setText] = useState('')
  const [market, setMarket] = useState<'CN_A' | 'HK'>('CN_A')

  async function run() {
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) {
      onMessage('至少表头+一行数据')
      return
    }
    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim())
    const idx = (name: string) => header.findIndex((h) => h === name)

    const cSide = idx('side')
    const cSym = idx('symbol')
    const cQty = idx('quantity')
    const cPrice = idx('price')
    const cAmt = idx('amount')
    const cDate = idx('trade_date')
    if (cSym < 0 || cQty < 0 || cPrice < 0 || cDate < 0) {
      onMessage(
        '需列: symbol, quantity, price, trade_date；可选 side, amount',
      )
      return
    }

    const { data: u } = await supabase.auth.getUser()
    if (!u.user) {
      onMessage('未登录')
      return
    }
    let { data: fs } = await supabase
      .from('fee_settings')
      .select('params')
      .eq('user_id', u.user.id)
      .eq('market', market)
      .eq('portfolio_id', portfolioId)
      .maybeSingle()
    if (!fs?.params) {
      const { data: g } = await supabase
        .from('fee_settings')
        .select('params')
        .eq('user_id', u.user.id)
        .eq('market', market)
        .is('portfolio_id', null)
        .maybeSingle()
      fs = g ?? fs
    }
    const feeP = {
      ...defaultFeeParams[market],
      ...((fs?.params as object) || {}),
    }

    const rows: Record<string, unknown>[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      const g = (j: number) => (j >= 0 ? cols[j] : '')
      const sideRaw = (cSide >= 0 ? g(cSide) : 'buy').toLowerCase()
      const side = sideRaw.startsWith('s') ? 'sell' : 'buy'
      const symbol = g(cSym).toUpperCase()
      const quantity = Number(g(cQty))
      const price = Number(g(cPrice))
      let amount = cAmt >= 0 ? Number(g(cAmt)) : NaN
      if (!amount && quantity && price) amount = Math.round(quantity * price * 100) / 100
      const trade_date = g(cDate).slice(0, 10)
      const est = estimateFees(side, amount, market, feeP)
      rows.push({
        portfolio_id: portfolioId,
        market,
        side,
        symbol,
        quantity,
        price,
        amount,
        trade_date,
        fee_estimated_total: est.total,
        fee_estimated_breakdown: est,
      })
    }

    const { error } = await supabase.from('trades').insert(rows)
    if (error) onMessage(error.message)
    else {
      const scale = await runFeeCalibrationForMarket(supabase, {
        userId: u.user.id,
        portfolioId,
        market,
      })
      onMessage(
        scale != null
          ? `ok: 导入 ${rows.length} 条；已更新校准系数 ${scale}`
          : `ok: 导入 ${rows.length} 条`,
      )
    }
  }

  return (
    <div className="card">
      <h2>CSV 导入</h2>
      <p className="muted">
        第一行表头英文：symbol, quantity, price, trade_date [, side, amount]
      </p>
      <label>
        估算市场
        <select value={market} onChange={(e) => setMarket(e.target.value as 'CN_A' | 'HK')}>
          <option value="CN_A">CN_A</option>
          <option value="HK">HK</option>
        </select>
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        style={{ width: '100%', marginTop: 8, fontFamily: 'monospace' }}
        placeholder={`symbol,quantity,price,trade_date,side\n600000,100,10.5,2025-01-02,buy`}
      />
      <button type="button" style={{ marginTop: 8 }} onClick={() => void run()}>
        导入
      </button>
    </div>
  )
}
