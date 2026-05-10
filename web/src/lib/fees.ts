export type Market = 'CN_A' | 'HK'

export interface FeeParams {
  commissionBps: number
  minCommission: number
  stampDutySellBps: number
  transferFeeBps: number
  levyBps: number
  /** 随实付流水自动写入 fee_settings；对估算分项整体缩放，默认 1 */
  calibrationScale?: number
}

export const defaultFeeParams: Record<Market, FeeParams> = {
  CN_A: {
    commissionBps: 2.5,
    minCommission: 5,
    stampDutySellBps: 5,
    transferFeeBps: 0.1,
    levyBps: 0,
  },
  HK: {
    commissionBps: 2.5,
    minCommission: 50,
    stampDutySellBps: 10,
    transferFeeBps: 0,
    levyBps: 5.65,
  },
}

export function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function estimateFees(
  side: 'buy' | 'sell',
  amount: number,
  market: Market,
  p: FeeParams,
): { commission: number; stamp: number; transfer: number; levy: number; total: number } {
  if (amount <= 0)
    return { commission: 0, stamp: 0, transfer: 0, levy: 0, total: 0 }
  let commission = round2((amount * p.commissionBps) / 10000)
  if (commission < p.minCommission) commission = p.minCommission
  const stamp =
    side === 'sell' ? round2((amount * p.stampDutySellBps) / 10000) : 0
  const transfer = round2((amount * p.transferFeeBps) / 10000)
  const levy = round2((amount * p.levyBps) / 10000)
  const scale = p.calibrationScale ?? 1
  commission = round2(commission * scale)
  const stampS = round2(stamp * scale)
  const transferS = round2(transfer * scale)
  const levyS = round2(levy * scale)
  const total = round2(commission + stampS + transferS + levyS)
  return { commission, stamp: stampS, transfer: transferS, levy: levyS, total }
}

/** 全额卖出后的税后回款（成交额 − 卖出预估费） */
export function netProceedAfterSellFees(
  grossAmount: number,
  market: Market,
  p: FeeParams,
): number {
  if (grossAmount <= 0) return 0
  return round2(grossAmount - estimateFees('sell', grossAmount, market, p).total)
}

function roundPx(n: number) {
  return Math.round(n * 10000) / 10000
}

/**
 * 反推「全额卖出」时，税后回款达到 targetNetProceed 所需的每股名义价（二分法，依赖净回款随单价单调增）。
 */
export function sellPriceForTargetNetProceed(
  targetNetProceed: number,
  quantity: number,
  market: Market,
  p: FeeParams,
): number | null {
  if (quantity <= 0 || targetNetProceed < 0) return null
  const f = (price: number) =>
    netProceedAfterSellFees(price * quantity, market, p)
  if (f(0) > targetNetProceed) return null
  let lo = 0
  let hi = Math.max(targetNetProceed / quantity, 1e-6)
  let nHi = f(hi)
  for (let g = 0; g < 80 && nHi < targetNetProceed; g++) {
    hi *= 2
    nHi = f(hi)
  }
  if (nHi < targetNetProceed) return null
  for (let i = 0; i < 72; i++) {
    const mid = (lo + hi) / 2
    const n = f(mid)
    if (Math.abs(n - targetNetProceed) < 0.02) return roundPx(mid)
    if (n < targetNetProceed) lo = mid
    else hi = mid
  }
  return roundPx((lo + hi) / 2)
}
