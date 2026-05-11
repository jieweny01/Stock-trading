import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  avgCost,
  appendPriceTrackPoint,
  clearPriceTrack,
  loadHoldingsPricesBlob,
  loadPriceTrack,
  loadTrackPrevCloseManual,
  positionsAsOf,
  positionsCurrent,
  saveHoldingsPricesBlob,
  saveTrackPrevCloseManual,
  type LotPosition,
  type PriceTrackPoint,
  type Trade,
} from '../lib/holdings'
import {
  defaultFeeParams,
  estimateFees,
  round2,
  sellPriceForTargetNetProceed,
  type FeeParams,
  type Market,
} from '../lib/fees'
import { fetchMergedFeeParams } from '../lib/feeParamsLoad'
import { TrialLegsSimulation } from './TrialLegsSimulation'

async function fetchLatestSnapshotCloseBeforeToday(
  supabase: SupabaseClient,
  portfolioId: string,
  symbol: string,
): Promise<{ close: number; snapshotDate: string } | null> {
  const sym = symbol.trim().toUpperCase()
  if (!sym) return null
  const today = new Date().toISOString().slice(0, 10)

  const { data: snaps, error: e1 } = await supabase
    .from('daily_snapshot')
    .select('id, snapshot_date')
    .eq('portfolio_id', portfolioId)
    .lt('snapshot_date', today)
    .order('snapshot_date', { ascending: false })
    .limit(120)

  if (e1 || !snaps?.length) return null

  for (const s of snaps) {
    const { data: row, error: e2 } = await supabase
      .from('snapshot_position')
      .select('input_close')
      .eq('snapshot_id', s.id)
      .eq('symbol', sym)
      .maybeSingle()
    if (e2) continue
    const cl = row?.input_close
    const n = cl != null ? Number(cl) : NaN
    if (Number.isFinite(n) && n > 0) {
      return { close: n, snapshotDate: s.snapshot_date }
    }
  }
  return null
}

function posMarket(p: LotPosition): Market {
  return p.market ?? 'CN_A'
}

function formatTrackDuration(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} 小时`
  return `${(ms / 86_400_000).toFixed(1)} 天`
}

function PriceTrackChart({
  data,
  prevClose,
}: {
  data: PriceTrackPoint[]
  prevClose: number | null
}) {
  const pc =
    prevClose != null && Number.isFinite(prevClose) && prevClose > 0
      ? prevClose
      : null
  const hasPoints = data.length >= 1
  const hasLine = data.length >= 2
  if (!hasPoints && pc == null) {
    return (
      <p className="muted holdings-track-chart-placeholder" style={{ margin: 0 }}>
        记入价格或加载<strong>昨收</strong>后显示图表。
      </p>
    )
  }

  const W = 640
  const H = 200
  const padL = 44
  const padR = 12
  const padT = 22
  const padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  let t0: number
  let t1: number
  if (data.length >= 2) {
    t0 = data[0].t
    t1 = data[data.length - 1].t
  } else if (data.length === 1) {
    const half = 43_200_000
    t0 = data[0].t - half
    t1 = data[0].t + half
  } else {
    const now = Date.now()
    t0 = now - 86_400_000
    t1 = now
  }

  const pricePool: number[] = data.map((d) => d.p)
  if (pc != null) pricePool.push(pc)
  let pMin = Math.min(...pricePool)
  let pMax = Math.max(...pricePool)
  const spread = pMax - pMin || 1e-9
  const padY = Math.max(spread * 0.08, 1e-6)
  pMin -= padY
  pMax += padY
  const spanT = t1 - t0 || 1
  const xAt = (t: number) => padL + ((t - t0) / spanT) * plotW
  const yAt = (p: number) =>
    padT + plotH - ((p - pMin) / (pMax - pMin)) * plotH

  const yPrev = pc != null ? yAt(pc) : 0

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="holdings-track-chart"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="现价走势与昨收"
    >
      <rect
        x={padL}
        y={padT}
        width={plotW}
        height={plotH}
        fill="rgba(212, 175, 55, 0.06)"
        stroke="rgba(212, 175, 55, 0.2)"
      />
      {pc != null ? (
        <>
          <line
            x1={padL}
            x2={padL + plotW}
            y1={yPrev}
            y2={yPrev}
            stroke="#5b9ede"
            strokeWidth="1.75"
            strokeDasharray="5 4"
            opacity={0.95}
          />
          <text
            x={padL + plotW - 4}
            y={yPrev - 5}
            fill="#5b9ede"
            fontSize="10"
            textAnchor="end"
          >
            昨收 {pc.toFixed(4)}
          </text>
        </>
      ) : null}
      {hasLine ? (
        <polyline
          fill="none"
          stroke="#d4af37"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={data.map((d) => `${xAt(d.t).toFixed(1)},${yAt(d.p).toFixed(1)}`).join(' ')}
        />
      ) : hasPoints ? (
        <circle
          cx={xAt(data[0].t)}
          cy={yAt(data[0].p)}
          r="4.5"
          fill="#d4af37"
          stroke="#2a2824"
          strokeWidth="1"
        />
      ) : null}
      <g transform={`translate(${padL + 4}, ${padT + 11})`}>
        <line x1="0" x2="14" y1="6" y2="6" stroke="#d4af37" strokeWidth="2" />
        <text x="18" y="10" fill="#9b9893" fontSize="10">
          走势
        </text>
        <line
          x1="52"
          x2="66"
          y1="6"
          y2="6"
          stroke="#5b9ede"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <text x="70" y="10" fill="#9b9893" fontSize="10">
          昨收
        </text>
      </g>
      <text x={padL} y={padT - 2} fill="#9b9893" fontSize="11">
        {pMax.toFixed(4)}
      </text>
      <text x={padL} y={padT + plotH + 4} fill="#9b9893" fontSize="11">
        {pMin.toFixed(4)}
      </text>
    </svg>
  )
}

type SnapRow = { symbol: string; quantity: number; input_close: string }

export function HoldingsPanel({
  supabase,
  portfolioId,
  onMessage,
}: {
  supabase: SupabaseClient
  portfolioId: string
  onMessage?: (s: string) => void
}) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [feeByMkt, setFeeByMkt] = useState<Record<Market, FeeParams>>({
    CN_A: defaultFeeParams.CN_A,
    HK: defaultFeeParams.HK,
  })
  const [focusSym, setFocusSym] = useState('')
  const [focusPrice, setFocusPrice] = useState('')
  const hydratedPid = useRef<string | null>(null)
  /** 切换组合后仅在首次有持仓且本地无记住代码时默认第一只 */
  const shouldDefaultFocusSymRef = useRef(true)
  /** 上一次已为试算现价建立过联动关系的代码（大写） */
  const lastPriceFocusSymRef = useRef('')
  /** 正在为「无本地记住代码」用户写入默认第一只，避免误清空已恢复的试算价 */
  const defaultingFocusSymRef = useRef(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('trades')
        .select(
          'id, side, symbol, quantity, price, amount, trade_date, market, fee_commission, fee_stamp, fee_transfer, fee_levy, fee_other',
        )
        .eq('portfolio_id', portfolioId)
        .order('trade_date', { ascending: true })
      setTrades((data ?? []) as Trade[])
    })()
  }, [supabase, portfolioId])

  useEffect(() => {
    void (async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u.user) return
      const [cn, hk] = await Promise.all([
        fetchMergedFeeParams(supabase, u.user.id, portfolioId, 'CN_A'),
        fetchMergedFeeParams(supabase, u.user.id, portfolioId, 'HK'),
      ])
      setFeeByMkt({ CN_A: cn, HK: hk })
    })()
  }, [supabase, portfolioId])

  const posMap = useMemo(() => {
    try {
      return positionsCurrent(trades)
    } catch {
      return new Map<string, LotPosition>()
    }
  }, [trades])

  const list = useMemo(
    () => [...posMap.values()].filter((p) => p.quantity > 0),
    [posMap],
  )

  useLayoutEffect(() => {
    const b = loadHoldingsPricesBlob(portfolioId)
    setPrices(b.table)
    setFocusPrice(b.focusPrice)
    hydratedPid.current = portfolioId
    defaultingFocusSymRef.current = false
    const restored = (b.focusSymbol ?? '').trim()
    setFocusSym(restored)
    lastPriceFocusSymRef.current = restored.toUpperCase()
    shouldDefaultFocusSymRef.current = !restored
  }, [portfolioId])

  useLayoutEffect(() => {
    if (hydratedPid.current !== portfolioId) return
    if (list.length === 0) return
    if (!shouldDefaultFocusSymRef.current) return
    shouldDefaultFocusSymRef.current = false
    const sym = list[0].symbol
    const up = sym.trim().toUpperCase()
    defaultingFocusSymRef.current = true
    lastPriceFocusSymRef.current = up
    setFocusSym(sym)
  }, [list, portfolioId])

  /** 与表格该行现价联动；切换代码时按表格价刷新，无表价则清空（默认首只时保留本地已恢复的试算价） */
  useEffect(() => {
    const u = focusSym.trim().toUpperCase()
    if (!u) return
    if (!list.some((x) => x.symbol === u)) return

    const fromTable = prices[u] ?? ''

    if (defaultingFocusSymRef.current && u !== lastPriceFocusSymRef.current) {
      defaultingFocusSymRef.current = false
    }

    if (
      defaultingFocusSymRef.current &&
      u === lastPriceFocusSymRef.current
    ) {
      defaultingFocusSymRef.current = false
      if (fromTable !== '') setFocusPrice(fromTable)
      return
    }

    const symSwitch = lastPriceFocusSymRef.current !== u
    lastPriceFocusSymRef.current = u

    if (fromTable !== '') {
      setFocusPrice(fromTable)
      return
    }
    if (symSwitch) {
      setFocusPrice('')
    }
  }, [focusSym, list, prices])

  const focusPos = useMemo(() => {
    const u = focusSym.trim().toUpperCase()
    if (!u) return null
    return posMap.get(u) ?? null
  }, [focusSym, posMap])

  const focusPx = Number(focusPrice) || 0
  const focusAvg = focusPos ? avgCost(focusPos) : 0
  const focusMkt = focusPos ? posMarket(focusPos) : 'CN_A'
  const focusFeeP = feeByMkt[focusMkt]
  const focusGross =
    focusPos && focusPx > 0 ? focusPx * focusPos.quantity : 0
  const focusSellEst =
    focusGross > 0 ? estimateFees('sell', focusGross, focusMkt, focusFeeP) : null
  const focusNetMv =
    focusSellEst != null ? focusGross - focusSellEst.total : 0
  const focusPnl =
    focusPos && focusNetMv > 0 ? focusNetMv - focusPos.costRemaining : 0
  const focusPct =
    focusPos && focusPos.costRemaining > 0
      ? (focusPnl / focusPos.costRemaining) * 100
      : 0

  const [targetMode, setTargetMode] = useState<'amount' | 'pct'>('amount')
  const [targetLo, setTargetLo] = useState('')
  const [targetHi, setTargetHi] = useState('')
  const [trackSeries, setTrackSeries] = useState<PriceTrackPoint[]>([])
  const [trackPriceInput, setTrackPriceInput] = useState('')
  const [snapshotRefClose, setSnapshotRefClose] = useState<{
    close: number
    snapshotDate: string
  } | null>(null)
  const [manualPrevCloseInput, setManualPrevCloseInput] = useState('')
  const [prevCloseLoading, setPrevCloseLoading] = useState(false)
  const trackPx = Number(trackPriceInput) || 0
  const lastTrackKey = useRef('')

  const targetPriceRange = useMemo(() => {
    if (!focusPos || focusPos.quantity <= 0) return null
    const C = focusPos.costRemaining
    const q = focusPos.quantity
    const mkt = posMarket(focusPos)
    const feeP = feeByMkt[mkt]
    let profitA: number
    let profitB: number
    if (targetMode === 'amount') {
      const x = targetLo.trim() ? Number(targetLo) : NaN
      const y = targetHi.trim() ? Number(targetHi) : NaN
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      profitA = x
      profitB = y
    } else {
      const xu = targetLo.trim() ? Number(targetLo) : NaN
      const yu = targetHi.trim() ? Number(targetHi) : NaN
      if (!Number.isFinite(xu) || !Number.isFinite(yu)) return null
      profitA = C * (xu / 100)
      profitB = C * (yu / 100)
    }
    const profitLo = Math.min(profitA, profitB)
    const profitHi = Math.max(profitA, profitB)
    const netLo = C + profitLo
    const netHi = C + profitHi
    if (Math.min(netLo, netHi) < 0) {
      return {
        kind: 'invalid' as const,
        reason: '该区间要求的税后回款为负，请缩小亏损幅度。',
      }
    }
    const pxAtLo = sellPriceForTargetNetProceed(netLo, q, mkt, feeP)
    const pxAtHi = sellPriceForTargetNetProceed(netHi, q, mkt, feeP)
    if (pxAtLo == null || pxAtHi == null) {
      return {
        kind: 'invalid' as const,
        reason: '无法反推出单价（数值过大或过小），请检查区间。',
      }
    }
    return {
      kind: 'ok' as const,
      profitLo,
      profitHi,
      netLo,
      netHi,
      priceMin: Math.min(pxAtLo, pxAtHi),
      priceMax: Math.max(pxAtLo, pxAtHi),
    }
  }, [focusPos, feeByMkt, targetMode, targetLo, targetHi])

  const breakevenPx = useMemo(() => {
    if (!focusPos || focusPos.quantity <= 0) return null
    const C = focusPos.costRemaining
    const mkt = posMarket(focusPos)
    return sellPriceForTargetNetProceed(C, focusPos.quantity, mkt, feeByMkt[mkt])
  }, [focusPos, feeByMkt])

  useEffect(() => {
    const u = focusSym.trim().toUpperCase()
    if (!u || !focusPos) {
      setTrackSeries([])
      setTrackPriceInput('')
      lastTrackKey.current = ''
      setSnapshotRefClose(null)
      setManualPrevCloseInput('')
      setPrevCloseLoading(false)
      return
    }
    setManualPrevCloseInput(loadTrackPrevCloseManual(portfolioId, u))
    const key = `${portfolioId}:${u}`
    const loaded = loadPriceTrack(portfolioId, u)
    setTrackSeries(loaded)
    if (lastTrackKey.current !== key) {
      lastTrackKey.current = key
      const last = loaded[loaded.length - 1]
      setTrackPriceInput(last ? String(last.p) : '')
    }
    let cancelled = false
    setPrevCloseLoading(true)
    void fetchLatestSnapshotCloseBeforeToday(supabase, portfolioId, u).then(
      (row) => {
        if (!cancelled) {
          setSnapshotRefClose(row)
          setPrevCloseLoading(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [portfolioId, focusSym, focusPos, supabase])

  const trackStats = useMemo(() => {
    if (trackSeries.length === 0) return null
    const prices = trackSeries.map((x) => x.p)
    const minP = Math.min(...prices)
    const maxP = Math.max(...prices)
    const first = trackSeries[0].p
    const last = trackSeries[trackSeries.length - 1].p
    const t0 = trackSeries[0].t
    const t1 = trackSeries[trackSeries.length - 1].t
    const changePct = first !== 0 ? ((last - first) / first) * 100 : 0
    return {
      n: trackSeries.length,
      minP,
      maxP,
      first,
      last,
      changePct,
      spanMs: t1 - t0,
      t0,
      t1,
    }
  }, [trackSeries])

  const effectivePrevClose = useMemo(() => {
    const m = Number(manualPrevCloseInput)
    if (Number.isFinite(m) && m > 0) return m
    return snapshotRefClose?.close ?? null
  }, [manualPrevCloseInput, snapshotRefClose])

  const effectivePrevCloseSource = useMemo(() => {
    const m = Number(manualPrevCloseInput)
    if (Number.isFinite(m) && m > 0) return '手填昨收'
    if (snapshotRefClose) return `${snapshotRefClose.snapshotDate} 估值快照`
    return null
  }, [manualPrevCloseInput, snapshotRefClose])

  const trackRangeAdvice = useMemo(() => {
    const pc = effectivePrevClose
    if (pc == null || pc <= 0) {
      return {
        kind: 'need_close' as const,
      }
    }
    const vs = trackSeries.map((x) => x.p)
    const live =
      vs.length > 0 ? vs[vs.length - 1] : trackPx > 0 ? trackPx : null

    const parts: string[] = []
    if (live != null && live > 0) {
      const pct = ((live - pc) / pc) * 100
      parts.push(
        `当前名义价 ${live.toFixed(4)}，相对昨收 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%。`,
      )
    }

    if (vs.length >= 2) {
      const rets: number[] = []
      for (let i = 1; i < vs.length; i++) {
        const a = vs[i - 1]
        if (a > 1e-12) rets.push((vs[i] - a) / a)
      }
      if (rets.length > 0) {
        const mu = rets.reduce((a, b) => a + b, 0) / rets.length
        const variance =
          rets.reduce((s, r) => s + (r - mu) * (r - mu), 0) / rets.length
        const sd = Math.sqrt(Math.max(variance, 0))
        const k = 1.5
        const loN = pc * (1 + mu - k * sd)
        const hiN = pc * (1 + mu + k * sd)
        const loAdj = Math.min(loN, hiN)
        const hiAdj = Math.max(loN, hiN)
        parts.push(
          `据 ${vs.length} 个跟踪点的逐步涨跌（均值 ${(mu * 100).toFixed(3)}%、标准差 ${(sd * 100).toFixed(3)}%），粗估名义价参考带约 ${loAdj.toFixed(4)} ~ ${hiAdj.toFixed(4)}（经验带，仅供对照，非投资建议）。`,
        )
        if (live != null) {
          parts.push(
            live + 1e-9 >= loAdj && live - 1e-9 <= hiAdj
              ? '当前名义价落在上述经验带内。'
              : '当前名义价在上述经验带之外，与近期记录节奏差异较大。',
          )
        }
      }
      parts.push(
        `记录区间内实际名义价高低：${Math.min(...vs).toFixed(4)} ~ ${Math.max(...vs).toFixed(4)}。`,
      )
    } else if (vs.length === 1) {
      parts.push(
        `仅有 1 个记录点；多记几笔后估算更稳。该点相对昨收 ${(((vs[0] - pc) / pc) * 100).toFixed(2)}%。`,
      )
    } else {
      parts.push(
        '尚无跟踪点：可在上方记入名义价后，再结合昨收与波动统计查看参考带。',
      )
    }

    return { kind: 'ok' as const, parts }
  }, [effectivePrevClose, trackSeries, trackPx])

  const [snapDate, setSnapDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  )
  const [snapRows, setSnapRows] = useState<SnapRow[]>([])
  const [snapForce, setSnapForce] = useState(false)

  const snapLedger = useMemo(() => {
    try {
      return positionsAsOf(trades, snapDate)
    } catch {
      return new Map<string, LotPosition>()
    }
  }, [trades, snapDate])

  useEffect(() => {
    if (hydratedPid.current !== portfolioId) return
    const keep = new Set(list.map((p) => p.symbol))
    for (const r of snapRows) {
      const u = r.symbol.trim().toUpperCase()
      if (!u) continue
      const p = snapLedger.get(u)
      keep.add(p?.symbol ?? r.symbol.trim())
    }
    const pruned: Record<string, string> = {}
    for (const sym of keep) {
      const v = prices[sym]
      if (v != null && v !== '') pruned[sym] = v
    }
    saveHoldingsPricesBlob(portfolioId, {
      table: pruned,
      focusPrice,
      focusSymbol: focusSym.trim() || undefined,
    })
  }, [portfolioId, prices, focusPrice, focusSym, list, snapRows, snapLedger])

  /** 日期或流水变化时，按该日持仓刷新行；同代码已填的收盘价会保留；非流水持仓的手工行保留在表末 */
  useEffect(() => {
    try {
      const m = positionsAsOf(trades, snapDate)
      setSnapRows((prev) => {
        const closeBySym = new Map(
          prev.map((r) => [r.symbol.trim().toUpperCase(), r.input_close]),
        )
        const inLedger = new Set<string>()
        const next: SnapRow[] = []
        for (const p of m.values()) {
          if (p.quantity > 0) {
            const sym = p.symbol
            const u = sym.toUpperCase()
            inLedger.add(u)
            next.push({
              symbol: sym,
              quantity: p.quantity,
              input_close: closeBySym.get(u) ?? '',
            })
          }
        }
        const orphans: SnapRow[] = []
        for (const r of prev) {
          const u = r.symbol.trim().toUpperCase()
          if (!u) {
            orphans.push(r)
            continue
          }
          if (!inLedger.has(u)) orphans.push(r)
        }
        return [...next, ...orphans]
      })
    } catch {
      setSnapRows([])
    }
  }, [trades, snapDate])

  async function saveSnapshot() {
    const ledger = positionsAsOf(trades, snapDate)
    for (const r of snapRows) {
      if (!r.symbol.trim()) continue
      const sym = r.symbol.trim().toUpperCase()
      const q = Number(r.quantity)
      const lq = ledger.get(sym)?.quantity ?? 0
      if (Math.abs(q - lq) > 1e-6 && !snapForce) {
        onMessage?.(
          `不一致: ${sym} 快照 ${q} vs 流水 ${lq}，请勾选强制或修改`,
        )
        return
      }
    }

    const { data: exist } = await supabase
      .from('daily_snapshot')
      .select('id')
      .eq('portfolio_id', portfolioId)
      .eq('snapshot_date', snapDate)
      .maybeSingle()

    if (exist?.id) {
      await supabase.from('snapshot_position').delete().eq('snapshot_id', exist.id)
      await supabase.from('daily_snapshot').delete().eq('id', exist.id)
    }

    let totalMv = 0
    const children: {
      symbol: string
      quantity: number
      input_close: number | null
      market_value: number | null
    }[] = []
    for (const r of snapRows) {
      if (!r.symbol.trim()) continue
      const sym = r.symbol.trim().toUpperCase()
      const q = Number(r.quantity)
      const mkt: Market = ledger.get(sym)?.market ?? 'CN_A'
      const feeP = feeByMkt[mkt]
      const cl = r.input_close ? Number(r.input_close) : null
      const gross =
        cl != null && !Number.isNaN(cl) && q > 0 ? cl * q : null
      const mv =
        gross != null
          ? round2(gross - estimateFees('sell', gross, mkt, feeP).total)
          : null
      if (mv != null) totalMv += mv
      children.push({
        symbol: sym,
        quantity: q,
        input_close: cl,
        market_value: mv,
      })
    }

    const { data: snap, error: e1 } = await supabase
      .from('daily_snapshot')
      .insert({
        portfolio_id: portfolioId,
        snapshot_date: snapDate,
        total_market_value: totalMv,
      })
      .select('id')
      .single()
    if (e1) {
      onMessage?.(e1.message)
      return
    }
    const sid = snap.id
    const { error: e2 } = await supabase.from('snapshot_position').insert(
      children.map((c) => ({
        snapshot_id: sid,
        symbol: c.symbol,
        quantity: c.quantity,
        input_close: c.input_close,
        market_value: c.market_value,
      })),
    )
    if (e2) onMessage?.(e2.message)
    else onMessage?.('ok: 快照已保存')
  }

  return (
    <div>
      <div className="card">
        <h2>测算</h2>
        <p className="muted" style={{ marginTop: '-0.25rem' }}>
          剩余成本与流水一致；浮动盈亏/<strong>目标反推</strong>均按费参数做
          <strong>全额卖出</strong>、扣卖出侧预估费后的<strong>税后</strong>口径。
          下方<strong>现价跟踪</strong>将测算名义价按时间记在本地浏览器。
          <strong>代码</strong>可从列表选择或手输，会与试算现价一并记入本机。
        </p>
        <div className="row">
          <label>
            代码
            <input
              list="holdings-symbols"
              value={focusSym}
              placeholder="如 600000"
              onChange={(e) => {
                const v = e.target.value.toUpperCase()
                setFocusSym(v)
                if (!v.trim()) {
                  setFocusPrice('')
                  lastPriceFocusSymRef.current = ''
                }
              }}
            />
            <datalist id="holdings-symbols">
              {list.map((p) => (
                <option key={p.symbol} value={p.symbol} />
              ))}
            </datalist>
          </label>
          <label>
            现价
            <input
              inputMode="decimal"
              value={focusPrice}
              onChange={(e) => {
                const v = e.target.value
                setFocusPrice(v)
                const u = focusSym.trim().toUpperCase()
                if (u) setPrices((prev) => ({ ...prev, [u]: v }))
              }}
              placeholder="试算用，与下方表格该行联动"
            />
          </label>
        </div>

        <TrialLegsSimulation defaultMarket={focusMkt} feeByMkt={feeByMkt} />

        {!focusPos || focusPos.quantity <= 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            当前组合里没有该代码的持仓。
          </p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 10, lineHeight: 1.55 }}>
              <strong>{focusPos.symbol}</strong> · 市场{' '}
              {focusMkt === 'HK' ? '港股' : 'A 股'} · 持仓{' '}
              {focusPos.quantity} · 摊薄 {focusAvg.toFixed(4)} / 股 · 剩余成本{' '}
              {focusPos.costRemaining.toFixed(2)}
              {breakevenPx != null && (
                <>
                  {' '}
                  · 保本名义价约 <strong>{breakevenPx.toFixed(4)}</strong> 元/股
                </>
              )}
            </p>

            <div className="holdings-trial-section">
              <h3 className="holdings-trial-h3">现价试算</h3>
              {focusPx > 0 ? (
                <>
                  <p>
                    毛市值 {focusGross.toFixed(2)}；预估卖出费{' '}
                    {focusSellEst ? focusSellEst.total.toFixed(2) : '-'}；税后{' '}
                    {focusNetMv.toFixed(2)}
                  </p>
                  <p>
                    浮动盈亏（税后）{' '}
                    <span className={focusPnl >= 0 ? 'pnl-up' : 'pnl-down'}>
                      {focusPnl.toFixed(2)}（{focusPct.toFixed(2)}%）
                    </span>
                  </p>
                </>
              ) : (
                <p className="muted">填写现价后显示市值与盈亏。</p>
              )}
            </div>

            <div className="holdings-trial-section">
              <h3 className="holdings-trial-h3">目标盈亏 → 卖出名义价</h3>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <label>
                  口径
                  <select
                    value={targetMode}
                    onChange={(e) =>
                      setTargetMode(e.target.value as 'amount' | 'pct')
                    }
                  >
                    <option value="amount">税后盈亏（元）</option>
                    <option value="pct">税后盈亏（占剩余成本 %）</option>
                  </select>
                </label>
                <label>
                  {targetMode === 'amount' ? '下限（元）' : '下限（%）'}
                  <input
                    inputMode="decimal"
                    placeholder={targetMode === 'amount' ? '-500' : '-5'}
                    value={targetLo}
                    onChange={(e) => setTargetLo(e.target.value)}
                  />
                </label>
                <label>
                  {targetMode === 'amount' ? '上限（元）' : '上限（%）'}
                  <input
                    inputMode="decimal"
                    placeholder={targetMode === 'amount' ? '2000' : '8'}
                    value={targetHi}
                    onChange={(e) => setTargetHi(e.target.value)}
                  />
                </label>
              </div>
              {!targetPriceRange ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  请填写上限、下限两格（可负）。
                </p>
              ) : targetPriceRange.kind === 'invalid' ? (
                <p className="error" style={{ marginTop: 8 }}>
                  {targetPriceRange.reason}
                </p>
              ) : (
                <div style={{ marginTop: 10, lineHeight: 1.6 }}>
                  <p>
                    目标税后盈亏{' '}
                    <strong>
                      <span
                        className={
                          targetPriceRange.profitLo >= 0 ? 'pnl-up' : 'pnl-down'
                        }
                      >
                        {targetPriceRange.profitLo.toFixed(2)}
                      </span>
                      {' ~ '}
                      <span
                        className={
                          targetPriceRange.profitHi >= 0 ? 'pnl-up' : 'pnl-down'
                        }
                      >
                        {targetPriceRange.profitHi.toFixed(2)}
                      </span>
                    </strong>
                    {' '}元
                    ，税后回款{' '}
                    <strong>
                      {targetPriceRange.netLo.toFixed(2)} ~
                      {targetPriceRange.netHi.toFixed(2)}
                    </strong>
                  </p>
                  <p>
                    对应卖出名义价（约）{' '}
                    <strong>
                      {targetPriceRange.priceMin.toFixed(4)} ~
                      {targetPriceRange.priceMax.toFixed(4)}
                    </strong>{' '}
                    元/股
                  </p>
                </div>
              )}
            </div>

            <div className="holdings-trial-section">
              <h3 className="holdings-trial-h3">现价跟踪</h3>
              <div className="holdings-track-layout">
                <div className="holdings-track-col-left">
                  <p className="muted" style={{ marginTop: 0 }}>
                    仅输入要记录的名义价，<strong>时间自动取当前时刻</strong>
                    （仅存本机）；点「记一笔」写入一条。蓝色虚线为
                    <strong>昨收</strong>：默认取最近一条早于今日的估值快照中该代码的收盘，可在上方手填覆盖。
                  </p>
                  <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <label>
                      记入现价
                      <input
                        inputMode="decimal"
                        value={trackPriceInput}
                        onChange={(e) => setTrackPriceInput(e.target.value)}
                        placeholder="如 10.25"
                      />
                    </label>
                    <label>
                      昨收（手填优先）
                      <input
                        inputMode="decimal"
                        value={manualPrevCloseInput}
                        placeholder={
                          snapshotRefClose
                            ? `快照 ${snapshotRefClose.close.toFixed(4)}`
                            : '如 10.20'
                        }
                        onChange={(e) => {
                          const v = e.target.value
                          setManualPrevCloseInput(v)
                          const u = focusSym.trim().toUpperCase()
                          if (u) saveTrackPrevCloseManual(portfolioId, u, v)
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const u = focusSym.trim().toUpperCase()
                        if (!u || !focusPos || trackPx <= 0) return
                        setTrackSeries(
                          appendPriceTrackPoint(portfolioId, u, trackPx),
                        )
                      }}
                      disabled={trackPx <= 0}
                    >
                      记一笔
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        const u = focusSym.trim().toUpperCase()
                        if (!u || !confirm('清空该标的在本机的全部跟踪点？'))
                          return
                        clearPriceTrack(portfolioId, u)
                        setTrackSeries([])
                      }}
                    >
                      清空记录
                    </button>
                  </div>
                  <p className="muted" style={{ marginTop: 8, fontSize: '0.9em' }}>
                    {prevCloseLoading
                      ? '正在加载快照昨收…'
                      : effectivePrevClose != null && effectivePrevCloseSource
                        ? `昨收参考 ${effectivePrevClose.toFixed(4)}（${effectivePrevCloseSource}）`
                        : '暂无快照昨收：请先保存估值快照或在上方手填。'}
                  </p>
                  {trackStats ? (
                    <p
                      className="muted"
                      style={{ marginTop: 10, lineHeight: 1.55 }}
                    >
                      共 <strong>{trackStats.n}</strong> 条；跨度{' '}
                      {formatTrackDuration(trackStats.spanMs)}（
                      {new Date(trackStats.t0).toLocaleString('zh-CN', {
                        hour12: false,
                      })}{' '}
                      —{' '}
                      {new Date(trackStats.t1).toLocaleString('zh-CN', {
                        hour12: false,
                      })}
                      ）；低 <strong>{trackStats.minP.toFixed(4)}</strong> / 高{' '}
                      <strong>{trackStats.maxP.toFixed(4)}</strong> / 最新{' '}
                      <strong>{trackStats.last.toFixed(4)}</strong>
                      {trackStats.n >= 2 ? (
                        <>
                          {' '}
                          · 首尾涨跌{' '}
                          <span
                            className={
                              trackStats.changePct >= 0
                                ? 'pnl-up'
                                : 'pnl-down'
                            }
                          >
                            {trackStats.changePct >= 0 ? '+' : ''}
                            {trackStats.changePct.toFixed(2)}%
                          </span>
                        </>
                      ) : null}
                    </p>
                  ) : (
                    <p className="muted" style={{ marginTop: 10 }}>
                      在「记入现价」中填写价格后点「记一笔」。右侧显示走势、昨收线与参考说明。
                    </p>
                  )}
                  <div
                    style={{
                      marginTop: 12,
                      padding: '10px 12px',
                      borderRadius: 6,
                      background: 'rgba(212, 175, 55, 0.07)',
                      border: '1px solid rgba(212, 175, 55, 0.22)',
                      lineHeight: 1.55,
                    }}
                  >
                    <strong style={{ color: 'var(--gold-muted, #b8a06a)' }}>
                      收益范围参考
                    </strong>
                    {trackRangeAdvice.kind === 'need_close' ? (
                      <p className="muted" style={{ margin: '8px 0 0' }}>
                        需有效昨收：请在「估值快照」中保存含收盘的记录，或在上方手填昨收。
                      </p>
                    ) : (
                      trackRangeAdvice.parts.map((t, i) => (
                        <p key={i} className="muted" style={{ margin: '8px 0 0' }}>
                          {t}
                        </p>
                      ))
                    )}
                  </div>
                </div>
                <div className="holdings-track-col-right">
                  <div className="holdings-track-chart-panel">
                    {trackSeries.length === 0 && effectivePrevClose == null ? (
                      <p className="muted holdings-track-chart-placeholder">
                        暂无记录点与昨收。记入价格或加载/手填<strong>昨收</strong>
                        后显示图表。
                      </p>
                    ) : (
                      <PriceTrackChart
                        data={trackSeries}
                        prevClose={effectivePrevClose}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>持仓与浮动盈亏</h2>
        <p className="muted" style={{ marginTop: '-0.25rem' }}>
          选好<strong>快照日期</strong>后，摊薄/剩余成本与数量按该日盘后流水重算；手输<strong>现价</strong>仍存本机。
          浮动盈亏按现价已扣<strong>预估卖出费</strong>（与「费参数」一致）。<strong>收盘</strong>用于当日估值快照，收市毛市值 / 卖出费 /
          净市值与下方保存逻辑一致。
        </p>

        <div className="holdings-trial-section" style={{ marginTop: '0.75rem' }}>
          <h3 className="holdings-trial-h3">估值快照</h3>
          <p className="muted" style={{ marginTop: '-0.15rem' }}>
            表格与该日持仓同步；填收盘后点保存。与流水数量不一致时勾选强制或改数；入库市值为扣卖出费后的净值。
          </p>
          <div className="row">
            <label>
              快照日期
              <input
                type="date"
                value={snapDate}
                onChange={(e) => setSnapDate(e.target.value)}
              />
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={snapForce}
                onChange={(e) => setSnapForce(e.target.checked)}
              />
              强制保存
            </label>
            <button type="button" onClick={() => void saveSnapshot()}>
              保存快照
            </button>
          </div>

          <details className="trades-details" style={{ marginTop: 12 }}>
            <summary>手动加一行（一般不常用）</summary>
            <button
              type="button"
              className="secondary"
              style={{ marginTop: 8 }}
              onClick={() =>
                setSnapRows((r) => [
                  ...r,
                  { symbol: '', quantity: 0, input_close: '' },
                ])
              }
            >
              加空行
            </button>
          </details>
        </div>

        {snapRows.length === 0 && <p className="muted">暂无持仓。</p>}
        {snapRows.length > 0 && (
          <>
          <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 6 }}>
            列较多时请<strong>横向滑动</strong>或拉宽窗口，右侧为现价、收盘与收市估值。线上若仍为旧版界面，请强制刷新（Ctrl+F5）或确认 GitHub Actions 部署已完成。
          </p>
          <div className="holdings-table-wrap" style={{ marginTop: 0 }}>
            <table className="holdings-table">
              <colgroup>
                <col className="holdings-c-sym" />
                <col className="holdings-c-qty" />
                <col className="holdings-c-mid" />
                <col className="holdings-c-mid" />
                <col className="holdings-c-px" />
                <col className="holdings-c-mid" />
                <col className="holdings-c-mid" />
                <col className="holdings-c-mid" />
                <col className="holdings-c-pnl" />
                <col className="holdings-c-px" />
                <col className="holdings-c-mid" />
                <col className="holdings-c-mid" />
                <col className="holdings-c-mid" />
              </colgroup>
              <thead>
                <tr>
                  <th>代码</th>
                  <th>数量</th>
                  <th>摊薄成本</th>
                  <th>剩余成本</th>
                  <th className="holdings-col-livepx">现价</th>
                  <th>毛市值</th>
                  <th>预估卖出费</th>
                  <th>税后市值</th>
                  <th className="holdings-col-pnl">浮动盈亏</th>
                  <th className="holdings-col-closepx">收盘</th>
                  <th>收市毛市值</th>
                  <th>收市卖出费</th>
                  <th>收市净市值</th>
                </tr>
              </thead>
              <tbody>
                {snapRows.map((r, i) => {
                  const sym = r.symbol.trim().toUpperCase()
                  const pos = sym ? snapLedger.get(sym) ?? null : null
                  const mkt: Market = pos?.market ?? 'CN_A'
                  const feeP = feeByMkt[mkt]
                  const pxKey = pos?.symbol ?? r.symbol.trim()
                  const pxRaw = pxKey ? prices[pxKey] ?? '' : ''
                  const px = Number(pxRaw || 0)
                  const q = Number(r.quantity)
                  const ac = pos && pos.quantity > 0 ? avgCost(pos) : null
                  const costRem = pos?.costRemaining

                  const liveGross = px > 0 && q > 0 ? px * q : 0
                  const liveSellEst =
                    liveGross > 0
                      ? estimateFees('sell', liveGross, mkt, feeP)
                      : null
                  const liveNet =
                    liveSellEst != null ? liveGross - liveSellEst.total : 0
                  const costForQty =
                    pos && pos.quantity > 1e-8 && costRem != null
                      ? costRem * (q / pos.quantity)
                      : null
                  const pnl =
                    costForQty != null ? liveNet - costForQty : 0
                  const pct =
                    costForQty != null && costForQty > 0
                      ? (pnl / costForQty) * 100
                      : 0

                  const cl = r.input_close ? Number(r.input_close) : NaN
                  const closeGross =
                    !Number.isNaN(cl) && q > 0 ? cl * q : null
                  const closeSellEst =
                    closeGross != null && closeGross > 0
                      ? estimateFees('sell', closeGross, mkt, feeP)
                      : null
                  const closeNet =
                    closeGross != null && closeSellEst != null
                      ? round2(closeGross - closeSellEst.total)
                      : null

                  return (
                    <tr key={`${i}-${sym || 'row'}`}>
                      <td>
                        <input
                          value={r.symbol}
                          onChange={(e) => {
                            const v = e.target.value
                            setSnapRows((x) =>
                              x.map((a, j) =>
                                j === i ? { ...a, symbol: v } : a,
                              ),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <input
                          value={r.quantity || ''}
                          onChange={(e) => {
                            const v = e.target.value
                            setSnapRows((x) =>
                              x.map((a, j) =>
                                j === i ? { ...a, quantity: Number(v) } : a,
                              ),
                            )
                          }}
                        />
                      </td>
                      <td>{ac != null ? ac.toFixed(4) : '-'}</td>
                      <td>
                        {costRem != null ? costRem.toFixed(2) : '-'}
                      </td>
                      <td className="holdings-col-livepx">
                        <input
                          className="holdings-px-input"
                          value={pxRaw}
                          onChange={(e) => {
                            const v = e.target.value
                            const k =
                              pxKey || r.symbol.trim().toUpperCase()
                            if (!k) return
                            setPrices((x) => ({ ...x, [k]: v }))
                            if (k === focusSym.trim().toUpperCase()) {
                              setFocusPrice(v)
                            }
                          }}
                        />
                      </td>
                      <td>{liveGross ? liveGross.toFixed(2) : '-'}</td>
                      <td>
                        {liveSellEst ? liveSellEst.total.toFixed(2) : '-'}
                      </td>
                      <td>{liveNet ? liveNet.toFixed(2) : '-'}</td>
                      <td className="holdings-col-pnl">
                        {costForQty != null ? (
                          <span
                            className={pnl >= 0 ? 'pnl-up' : 'pnl-down'}
                          >
                            {`${pnl.toFixed(2)} (${pct.toFixed(2)}%)`}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="holdings-col-closepx">
                        <input
                          className="holdings-px-input"
                          value={r.input_close}
                          onChange={(e) => {
                            const v = e.target.value
                            setSnapRows((x) =>
                              x.map((a, j) =>
                                j === i ? { ...a, input_close: v } : a,
                              ),
                            )
                          }}
                        />
                      </td>
                      <td>
                        {closeGross != null ? closeGross.toFixed(2) : '-'}
                      </td>
                      <td>
                        {closeSellEst
                          ? closeSellEst.total.toFixed(2)
                          : '-'}
                      </td>
                      <td>
                        {closeNet != null ? closeNet.toFixed(2) : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  )
}
