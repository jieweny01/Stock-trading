import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultFeeParams, type FeeParams, type Market } from './fees'

/** Portfolio fee row or account fallback (same rules as Trades reload). */
export async function fetchMergedFeeParams(
  supabase: SupabaseClient,
  userId: string,
  portfolioId: string,
  market: Market,
): Promise<FeeParams> {
  let { data } = await supabase
    .from('fee_settings')
    .select('params')
    .eq('user_id', userId)
    .eq('market', market)
    .eq('portfolio_id', portfolioId)
    .maybeSingle()
  if (!data?.params) {
    const { data: g } = await supabase
      .from('fee_settings')
      .select('params')
      .eq('user_id', userId)
      .eq('market', market)
      .is('portfolio_id', null)
      .maybeSingle()
    data = g ?? data
  }
  const p = (data?.params as FeeParams) || defaultFeeParams[market]
  return { ...defaultFeeParams[market], ...p }
}
