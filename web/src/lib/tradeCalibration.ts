import type { SupabaseClient } from '@supabase/supabase-js'
import {
  estimateFees,
  round2,
  type FeeParams,
  type Market,
} from './fees'
import { fetchMergedFeeParams } from './feeParamsLoad'

export type TradeFeeSample = {
  side: 'buy' | 'sell'
  amount: number
  market: Market
  fee_commission: number | null
  fee_stamp: number | null
  fee_transfer: number | null
  fee_levy: number | null
  fee_other: number | null
}

export function actualFeesSum(t: {
  fee_commission: number | null
  fee_stamp: number | null
  fee_transfer: number | null
  fee_levy: number | null
  fee_other: number | null
}): number {
  return round2(
    Number(t.fee_commission || 0) +
      Number(t.fee_stamp || 0) +
      Number(t.fee_transfer || 0) +
      Number(t.fee_levy || 0) +
      Number(t.fee_other || 0),
  )
}

const RATIO_CLAMP = { lo: 0.5, hi: 2.0 }
const MAX_SAMPLES = 50
const MIN_FOR_BPS_INFER = 3

function clampN(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x))
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export function inferBpsFromSamples(
  samples: TradeFeeSample[],
  current: FeeParams,
): Partial<FeeParams> {
  const out: Partial<FeeParams> = {}
  const amt = (t: TradeFeeSample) => Number(t.amount)

  const sellsStamp = samples.filter(
    (t) =>
      t.side === 'sell' && amt(t) > 0 && Number(t.fee_stamp || 0) > 0,
  )
  if (sellsStamp.length >= MIN_FOR_BPS_INFER) {
    const xs = sellsStamp.map((t) => (Number(t.fee_stamp) / amt(t)) * 10000)
    const m = median(xs)
    if (m != null)
      out.stampDutySellBps = round2(clampN(m, 0, 50))
  }

  const transfer = samples.filter(
    (t) => amt(t) > 0 && Number(t.fee_transfer || 0) > 0,
  )
  if (transfer.length >= MIN_FOR_BPS_INFER) {
    const xs = transfer.map((t) => (Number(t.fee_transfer) / amt(t)) * 10000)
    const m = median(xs)
    if (m != null) out.transferFeeBps = round2(clampN(m, 0, 5))
  }

  const levy = samples.filter(
    (t) => amt(t) > 0 && Number(t.fee_levy || 0) > 0,
  )
  if (levy.length >= MIN_FOR_BPS_INFER) {
    const xs = levy.map((t) => (Number(t.fee_levy) / amt(t)) * 10000)
    const m = median(xs)
    if (m != null) out.levyBps = round2(clampN(m, 0, 40))
  }

  const minC = current.minCommission
  const commAboveMin = samples.filter(
    (t) => amt(t) > 0 && Number(t.fee_commission || 0) > minC + 1e-6,
  )
  if (commAboveMin.length >= MIN_FOR_BPS_INFER) {
    const xs = commAboveMin.map(
      (t) => (Number(t.fee_commission) / amt(t)) * 10000,
    )
    const m = median(xs)
    if (m != null) out.commissionBps = round2(clampN(m, 0, 50))
  }

  return out
}

export function computeCalibrationScale(
  trades: TradeFeeSample[],
  baseParams: FeeParams,
): number {
  const stripped: FeeParams = { ...baseParams, calibrationScale: 1 }
  const ratios: number[] = []
  for (const t of trades) {
    const actual = actualFeesSum(t)
    if (actual <= 0) continue
    const est = estimateFees(t.side, Number(t.amount), t.market, stripped)
    if (est.total > 0.0001) ratios.push(actual / est.total)
  }
  if (ratios.length === 0) return 1
  const sorted = [...ratios].sort((a, b) => a - b)
  const mid = sorted[Math.floor(sorted.length / 2)]
  return round2(Math.min(RATIO_CLAMP.hi, Math.max(RATIO_CLAMP.lo, mid)))
}

async function persistFeeParams(
  supabase: SupabaseClient,
  userId: string,
  portfolioId: string,
  market: Market,
  params: FeeParams,
) {
  const del = supabase
    .from('fee_settings')
    .delete()
    .eq('user_id', userId)
    .eq('market', market)
    .eq('portfolio_id', portfolioId)
  await del
  await supabase.from('fee_settings').insert({
    user_id: userId,
    portfolio_id: portfolioId,
    market,
    params: params as unknown as Record<string, unknown>,
  })
}

export async function runFeeCalibrationForMarket(
  supabase: SupabaseClient,
  args: { userId: string; portfolioId: string; market: Market },
): Promise<number | null> {
  const baseP = await fetchMergedFeeParams(
    supabase,
    args.userId,
    args.portfolioId,
    args.market,
  )

  const { data: trades, error } = await supabase
    .from('trades')
    .select(
      'side, amount, market, fee_commission, fee_stamp, fee_transfer, fee_levy, fee_other, trade_date',
    )
    .eq('portfolio_id', args.portfolioId)
    .eq('market', args.market)
    .order('trade_date', { ascending: false })
    .limit(80)

  if (error || !trades?.length) return null

  const samples = trades
    .filter((t) => actualFeesSum(t as TradeFeeSample) > 0)
    .slice(0, MAX_SAMPLES) as TradeFeeSample[]

  if (samples.length === 0) return null

  const inferred = inferBpsFromSamples(samples, baseP)
  const tuned: FeeParams = { ...baseP, ...inferred }
  const newScale = computeCalibrationScale(samples, tuned)
  const nextParams: FeeParams = { ...tuned, calibrationScale: newScale }

  await persistFeeParams(
    supabase,
    args.userId,
    args.portfolioId,
    args.market,
    nextParams,
  )
  return newScale
}