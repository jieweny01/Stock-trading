import type { Market } from './fees'

export interface Trade {
  id: string
  side: 'buy' | 'sell'
  symbol: string
  quantity: number
  price: number
  amount: number
  trade_date: string
  settlement_date?: string | null
  notes?: string | null
  /** 与录入市场一致；旧数据缺省时按 A 股参与筛选 */
  market?: 'CN_A' | 'HK'
  fee_commission: number | null
  fee_stamp: number | null
  fee_transfer: number | null
  fee_levy: number | null
  fee_other: number | null
  fee_estimated_total?: number | null
}

function feesOnTrade(t: Trade): number {
  return (
    Number(t.fee_commission || 0) +
    Number(t.fee_stamp || 0) +
    Number(t.fee_transfer || 0) +
    Number(t.fee_levy || 0) +
    Number(t.fee_other || 0)
  )
}

function cmpTrade(a: Trade, b: Trade): number {
  if (a.trade_date !== b.trade_date)
    return a.trade_date < b.trade_date ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface LotPosition {
  symbol: string
  quantity: number
  costRemaining: number
  /** 该标的最后一笔流水的成交市场（缺省按 CN_A 参与卖出费估算） */
  market?: Market
}

function touchMarket(row: LotPosition, t: Trade) {
  if (t.market) row.market = t.market
}

/** 指定日期及之前成交的滚动持仓（摊薄成本法，卖出费不减剩余成本） */
export function positionsAsOf(
  trades: Trade[],
  asOf: string,
): Map<string, LotPosition> {
  const filtered = trades
    .filter((t) => t.trade_date <= asOf)
    .slice()
    .sort(cmpTrade)
  const m = new Map<string, LotPosition>()
  for (const t of filtered) {
    let row = m.get(t.symbol)
    if (!row) {
      row = { symbol: t.symbol, quantity: 0, costRemaining: 0 }
      m.set(t.symbol, row)
    }
    const q = Number(t.quantity)
    const amt = Number(t.amount)
    if (t.side === 'buy') {
      row.quantity += q
      row.costRemaining += amt + feesOnTrade(t)
      touchMarket(row, t)
    } else {
      if (row.quantity + 1e-9 < q)
        throw new Error(`卖出数量超过持仓: ${t.symbol} ${t.trade_date}`)
      const avg = row.costRemaining / row.quantity
      row.costRemaining -= avg * q
      row.quantity -= q
      if (row.quantity < 1e-8) {
        row.quantity = 0
        row.costRemaining = 0
      }
      touchMarket(row, t)
    }
  }
  return m
}

export function positionsCurrent(trades: Trade[]): Map<string, LotPosition> {
  const sorted = trades.slice().sort(cmpTrade)
  const m = new Map<string, LotPosition>()
  for (const t of sorted) {
    let row = m.get(t.symbol)
    if (!row) {
      row = { symbol: t.symbol, quantity: 0, costRemaining: 0 }
      m.set(t.symbol, row)
    }
    const q = Number(t.quantity)
    const amt = Number(t.amount)
    if (t.side === 'buy') {
      row.quantity += q
      row.costRemaining += amt + feesOnTrade(t)
      touchMarket(row, t)
    } else {
      if (row.quantity + 1e-9 < q)
        throw new Error(`卖出数量超过持仓: ${t.symbol} ${t.trade_date}`)
      const avg = row.costRemaining / row.quantity
      row.costRemaining -= avg * q
      row.quantity -= q
      if (row.quantity < 1e-8) {
        row.quantity = 0
        row.costRemaining = 0
      }
      touchMarket(row, t)
    }
  }
  return m
}

export function avgCost(row: LotPosition): number {
  if (row.quantity <= 0) return 0
  return row.costRemaining / row.quantity
}

/** 持仓现价（表格 + 测算框）：仅存浏览器，按组合持久化 */
const HOLDINGS_PX_VER = 'v1'

function holdingsPxKey(portfolioId: string) {
  return `sc-holdings-px-${HOLDINGS_PX_VER}:${portfolioId}`
}

export type HoldingsPricesBlob = {
  table: Record<string, string>
  focusPrice: string
  /** 测算区选中的代码（本地持久化，可选） */
  focusSymbol?: string
}

export function loadHoldingsPricesBlob(portfolioId: string): HoldingsPricesBlob {
  const empty: HoldingsPricesBlob = { table: {}, focusPrice: '' }
  try {
    const raw = localStorage.getItem(holdingsPxKey(portfolioId))
    if (!raw) return empty
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return empty
    const rec = o as Record<string, unknown>
    const tableRaw = rec.table
    const focusPrice =
      typeof rec.focusPrice === 'string' ? rec.focusPrice : ''
    const focusSymbol =
      typeof rec.focusSymbol === 'string' ? rec.focusSymbol : undefined
    if (!tableRaw || typeof tableRaw !== 'object') {
      return { table: {}, focusPrice, focusSymbol }
    }
    const table: Record<string, string> = {}
    for (const [k, v] of Object.entries(tableRaw)) {
      if (typeof v === 'string') table[k.toUpperCase()] = v
    }
    return { table, focusPrice, focusSymbol }
  } catch {
    return empty
  }
}

export function saveHoldingsPricesBlob(
  portfolioId: string,
  blob: HoldingsPricesBlob,
): void {
  try {
    localStorage.setItem(holdingsPxKey(portfolioId), JSON.stringify(blob))
  } catch {
    /* ignore */
  }
}

/** 测算「现价跟踪」时间序列：仅存浏览器，按组合 + 代码 */
const TRACK_VER = 'v1'
const MAX_TRACK_POINTS = 2000

function priceTrackStorageKey(portfolioId: string, symbol: string) {
  return `sc-px-track-${TRACK_VER}:${portfolioId}:${symbol.trim().toUpperCase()}`
}

export type PriceTrackPoint = { t: number; p: number }

export function loadPriceTrack(
  portfolioId: string,
  symbol: string,
): PriceTrackPoint[] {
  try {
    const raw = localStorage.getItem(priceTrackStorageKey(portfolioId, symbol))
    if (!raw) return []
    const a = JSON.parse(raw) as unknown
    if (!Array.isArray(a)) return []
    return a
      .filter(
        (x) =>
          x &&
          typeof x === 'object' &&
          typeof (x as PriceTrackPoint).t === 'number' &&
          typeof (x as PriceTrackPoint).p === 'number' &&
          Number.isFinite((x as PriceTrackPoint).p) &&
          (x as PriceTrackPoint).p > 0,
      )
      .map((x) => x as PriceTrackPoint)
      .sort((u, v) => u.t - v.t)
  } catch {
    return []
  }
}

export function appendPriceTrackPoint(
  portfolioId: string,
  symbol: string,
  price: number,
): PriceTrackPoint[] {
  if (!Number.isFinite(price) || price <= 0) {
    return loadPriceTrack(portfolioId, symbol)
  }
  const pts = loadPriceTrack(portfolioId, symbol)
  const now = Date.now()
  const last = pts[pts.length - 1]
  if (last && last.p === price && now - last.t < 800) return pts
  pts.push({ t: now, p: price })
  const trimmed = pts.slice(-MAX_TRACK_POINTS)
  try {
    localStorage.setItem(
      priceTrackStorageKey(portfolioId, symbol),
      JSON.stringify(trimmed),
    )
  } catch {
    /* ignore */
  }
  return trimmed
}

export function clearPriceTrack(portfolioId: string, symbol: string) {
  try {
    localStorage.removeItem(priceTrackStorageKey(portfolioId, symbol))
  } catch {
    /* ignore */
  }
}

/** 现价 tracking：手填「昨收」覆盖快照取值，按组合 + 代码存本机 */
const PREV_CLOSE_VER = 'v1'

function prevCloseStorageKey(portfolioId: string, symbol: string) {
  return `sc-track-prev-close-${PREV_CLOSE_VER}:${portfolioId}:${symbol.trim().toUpperCase()}`
}

export function loadTrackPrevCloseManual(
  portfolioId: string,
  symbol: string,
): string {
  try {
    const v = localStorage.getItem(prevCloseStorageKey(portfolioId, symbol))
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

export function saveTrackPrevCloseManual(
  portfolioId: string,
  symbol: string,
  raw: string,
): void {
  try {
    const k = prevCloseStorageKey(portfolioId, symbol)
    if (!raw.trim()) localStorage.removeItem(k)
    else localStorage.setItem(k, raw.trim())
  } catch {
    /* ignore */
  }
}
