export type DeepSeekPricingPeriod = 'peak' | 'off_peak' | 'unknown'

// https://www.gov.cn/zhengce/content/202511/content_7047090.htm
// Official holiday periods, including the announced days off. DeepSeek explicitly
// treats every weekend as off-peak, even a government-designated working weekend.
const HOLIDAYS: Record<number, ReadonlyArray<readonly [string, string]>> = {
  2026: [
    ['01-01', '01-03'],
    ['02-15', '02-23'],
    ['04-04', '04-06'],
    ['05-01', '05-05'],
    ['06-19', '06-21'],
    ['09-25', '09-27'],
    ['10-01', '10-07'],
  ],
}

// https://api-docs.deepseek.com/quick_start/pricing/
// Use the provider's response-created time, never the later stats-read time.
export function getDeepSeekPricingPeriod(timestamp?: string | Date | null): DeepSeekPricingPeriod {
  if (timestamp == null) return 'unknown'
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'unknown'
  const day = date.getUTCDay()
  const hour = date.getUTCHours()
  if (day === 0 || day === 6 || !((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)))
    return 'off_peak'
  // Peak windows are 09:00–12:00 and 14:00–18:00 in China, so the UTC date
  // and Chinese local date coincide here. Do not guess future holiday calendars.
  const holidays = HOLIDAYS[date.getUTCFullYear()]
  if (!holidays) return 'unknown'
  const monthDay = date.toISOString().slice(5, 10)
  return holidays.some(([from, to]) => monthDay >= from && monthDay <= to) ? 'off_peak' : 'peak'
}

export function summarizeDeepSeekPricingPeriods(periods: DeepSeekPricingPeriod[]) {
  if (!periods.length || periods.includes('unknown')) return 'unknown'
  return new Set(periods).size > 1 ? 'mixed' : periods[0]
}
