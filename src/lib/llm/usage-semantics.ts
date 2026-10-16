// These APIs report reasoning as a subset of output, unlike Google's separate
// thinking counter. Share this rule between pricing, receipts and display.
export function outputIncludesReasoning(provider: string | null | undefined): boolean {
  return provider === 'openai' || provider === 'deepseek' || provider === 'openrouter'
}
