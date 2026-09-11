// One static review invocation may use up to three turns, including structured-output formatting.
// Invocation counts are a separate controller/owner budget, never inferred from this turn limit.
export const REVIEW_MAX_TURNS = 3;
const restrictions = Object.freeze([
  '--safe-mode','-p','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
  '--setting-sources','','--disable-slash-commands','--no-session-persistence',
  '--no-chrome','--permission-mode','dontAsk','--max-turns',String(REVIEW_MAX_TURNS),
]);
// The only executable static-review flag source. Audit transport adds events, not capabilities.
export function staticReviewArgs(format: 'json' | 'stream-json' = 'json'): string[] {
  if (!['json','stream-json'].includes(format)) throw new Error('UNSUPPORTED_REVIEW_OUTPUT');
  return [...restrictions,'--output-format',format,...(format==='stream-json'?['--verbose','--include-hook-events']:[])];
}
