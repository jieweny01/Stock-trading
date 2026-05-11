import {
  estimateFees,
  round2,
  sellPriceForTargetNetProceed,
  type FeeParams,
  type Market,
} from './fees'
import type { LotPosition } from './holdings'

export type SimLegInput = {
  side: 'buy' | 'sell'
  quantity: number
  price: number
}

export type SimLegResult = {
  side: 'buy' | 'sell'
  quantity: number
  price: number
  gross: number
  feeTotal: number
  /** 该笔现金流：买入为负（支出），卖出为正（实收） */
  cashFlow: number
  /** 仅卖出腿：按摊薄成本法估算的本次实现盈亏 */
  realizedPnlLeg: number | null
  error?: string
}

export type SimLegsSummary = {
  results: SimLegResult[]
  totalFees: number
  netCash: number
  totalRealized: number
  finalQty: number
  finalCostRemaining: number
  /** 模拟结束后若有持仓：全额卖出且税后回款刚好覆盖剩余成本所需名义价（元/股），与测算区一致 */
  breakevenPx: number | null
  error?: string
}

/**
 * 按顺序模拟多笔买卖（摊薄成本 / 卖出费从回款扣），与流水持仓逻辑一致。
 */
export function simulateSequentialLegs(
  legs: SimLegInput[],
  market: Market,
  feeP: FeeParams,
): SimLegsSummary {
  const results: SimLegResult[] = []
  let qty = 0
  let costRem = 0
  let totalRealized = 0
  let totalFees = 0

  for (const leg of legs) {
    if (leg.quantity <= 0 || leg.price < 0 || !Number.isFinite(leg.quantity)) {
      results.push({
        side: leg.side,
        quantity: leg.quantity,
        price: leg.price,
        gross: 0,
        feeTotal: 0,
        cashFlow: 0,
        realizedPnlLeg: null,
        error: '数量须为正、价格不能为负',
      })
      return {
        results,
        totalFees: 0,
        netCash: 0,
        totalRealized: 0,
        finalQty: qty,
        finalCostRemaining: costRem,
        breakevenPx: null,
        error: '存在无效的模拟行',
      }
    }

    const gross = round2(leg.quantity * leg.price)
    if (leg.side === 'buy') {
      const est = estimateFees('buy', gross, market, feeP)
      totalFees = round2(totalFees + est.total)
      const cashOut = round2(gross + est.total)
      qty += leg.quantity
      costRem = round2(costRem + gross + est.total)
      results.push({
        side: 'buy',
        quantity: leg.quantity,
        price: leg.price,
        gross,
        feeTotal: est.total,
        cashFlow: -cashOut,
        realizedPnlLeg: null,
      })
    } else {
      const est = estimateFees('sell', gross, market, feeP)
      totalFees = round2(totalFees + est.total)
      if (qty + 1e-9 < leg.quantity) {
        results.push({
          side: 'sell',
          quantity: leg.quantity,
          price: leg.price,
          gross,
          feeTotal: est.total,
          cashFlow: 0,
          realizedPnlLeg: null,
          error: '卖出数量超过当前模拟持仓',
        })
        return {
          results,
          totalFees,
          netCash: 0,
          totalRealized: 0,
          finalQty: qty,
          finalCostRemaining: costRem,
          breakevenPx: null,
          error: '卖出数量超过当前模拟持仓',
        }
      }
      const avg = costRem / qty
      const cashIn = round2(gross - est.total)
      const costReleased = round2(avg * leg.quantity)
      const realized = round2(cashIn - costReleased)
      totalRealized = round2(totalRealized + realized)
      costRem = round2(costRem - costReleased)
      qty -= leg.quantity
      if (qty < 1e-8) {
        qty = 0
        costRem = 0
      }
      results.push({
        side: 'sell',
        quantity: leg.quantity,
        price: leg.price,
        gross,
        feeTotal: est.total,
        cashFlow: cashIn,
        realizedPnlLeg: realized,
      })
    }
  }

  const netCash = round2(results.reduce((s, r) => s + r.cashFlow, 0))
  const breakevenPx =
    qty > 1e-8
      ? sellPriceForTargetNetProceed(costRem, qty, market, feeP)
      : null
  return {
    results,
    totalFees,
    netCash,
    totalRealized,
    finalQty: qty,
    finalCostRemaining: costRem,
    breakevenPx,
  }
}

/** 与即将执行的卖出流水一致：用当前持仓（不含该笔）估算本笔已实现盈亏。 */
export function realizedPnlForNewSell(
  posBefore: LotPosition | undefined,
  sellQty: number,
  sellGrossAmount: number,
  sellFeesTotal: number,
): number | null {
  if (!posBefore || posBefore.quantity + 1e-9 < sellQty) return null
  const avg = posBefore.costRemaining / posBefore.quantity
  const cashIn = round2(sellGrossAmount - sellFeesTotal)
  const costReleased = round2(avg * sellQty)
  return round2(cashIn - costReleased)
}
