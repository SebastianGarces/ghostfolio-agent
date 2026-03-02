import type { ToolCallRecord } from './state';

// ---------------------------------------------------------------------------
// Condense tool artifacts into a compact text summary for the LLM
// ---------------------------------------------------------------------------

/**
 * Builds a compact text summary (~300-500 tokens) of tool artifacts.
 * Each tool type gets a custom condensation format optimized for LLM reasoning.
 */
export function condenseArtifacts(toolCalls: ToolCallRecord[]): string {
  const sections: string[] = [];

  for (const tc of toolCalls) {
    if (!tc.success || !tc.data) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = tc.data as any;

    switch (tc.name) {
      case 'portfolio_analysis': {
        const holdings = (d.holdings ?? []) as {
          symbol: string;
          name: string;
          allocation: number;
          netPerformancePercent?: number;
          assetClass?: string;
        }[];
        const s = d.summary;
        const lines: string[] = [];
        if (s) {
          const perfPct =
            s.netPerformancePercent != null
              ? ` (${(s.netPerformancePercent * 100).toFixed(1)}%)`
              : '';
          let summaryLine = `Net worth: ${s.currentNetWorth}, Investment: ${s.totalInvestment ?? 'N/A'}, Net perf: ${s.netPerformance ?? 'N/A'}${perfPct}`;
          if (s.dividend != null) {
            summaryLine += `, Dividends: ${s.dividend}`;
          }
          if (s.fees != null) {
            summaryLine += `, Fees: ${s.fees}`;
          }
          lines.push(summaryLine);
        }
        for (const h of holdings.slice(0, 10)) {
          const pct =
            h.allocation > 0 ? (h.allocation * 100).toFixed(1) + '%' : 'N/A';
          const perf =
            h.netPerformancePercent != null
              ? (h.netPerformancePercent * 100).toFixed(1) + '%'
              : 'N/A';
          lines.push(
            `${h.symbol} (${h.name}): alloc=${pct}, perf=${perf}, class=${h.assetClass ?? 'N/A'}`
          );
        }
        if (holdings.length > 10) {
          lines.push(`... and ${holdings.length - 10} more holdings`);
        }
        sections.push(`[portfolio_analysis]\n${lines.join('\n')}`);
        break;
      }
      case 'performance_report': {
        const m = d.metrics;
        if (m) {
          const perfPct =
            m.totalInvestment && m.netPerformance
              ? ((m.netPerformance / m.totalInvestment) * 100).toFixed(1) + '%'
              : 'N/A';
          sections.push(
            `[performance_report]\nNet worth: ${m.currentNetWorth}, Investment: ${m.totalInvestment}, Net perf: ${m.netPerformance} (${perfPct})`
          );
        }
        break;
      }
      case 'risk_assessment': {
        const stats = d.statistics;
        const failed = (d.categories ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .flatMap((c: any) => c.rules ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((r: any) => !r.passed)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((r: any) => r.name);
        sections.push(
          `[risk_assessment]\nPassed: ${stats?.rulesPassed}/${stats?.rulesTotal}. Failed: ${failed.length > 0 ? failed.join(', ') : 'none'}`
        );
        break;
      }
      case 'holdings_search': {
        const holdings = d.holdings ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = holdings
          .slice(0, 10)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((h: any) => `${h.symbol} (${h.name})`)
          .join(', ');
        sections.push(
          `[holdings_search]\nMatches (${holdings.length}): ${items}`
        );
        break;
      }
      case 'market_data_lookup': {
        if (Array.isArray(d.results)) {
          // Multi-symbol response
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lines = d.results.map((r: any) => {
            const label = r.name ?? r.symbol ?? 'Unknown';
            return `${label}: price=${r.price ?? r.marketPrice} ${r.currency ?? ''}`;
          });
          sections.push(`[market_data_lookup]\n${lines.join('\n')}`);
        } else {
          const label = d.name ?? d.symbol ?? 'Unknown';
          const price = d.price ?? d.marketPrice;
          sections.push(
            `[market_data_lookup]\n${label}: price=${price} ${d.currency ?? ''}`
          );
        }
        break;
      }
      case 'dividend_analysis': {
        sections.push(
          `[dividend_analysis]\nTotal dividends: ${d.totalDividends}`
        );
        break;
      }
      case 'investment_history': {
        let streak = '';
        if (d.streaks != null) {
          const current = d.streaks.current ?? 0;
          const longest = d.streaks.longest ?? 0;
          const parts: string[] = [];
          if (current >= 0) parts.push(`current streak: ${current} months`);
          if (longest > 0) parts.push(`longest streak: ${longest} months`);
          if (parts.length > 0) streak = `, ${parts.join(', ')}`;
        }
        sections.push(
          `[investment_history]\nTotal invested: ${d.totalInvested}${streak}`
        );
        break;
      }
      default: {
        // Generic: stringify up to 500 chars
        const json = JSON.stringify(d).slice(0, 500);
        sections.push(`[${tc.name}]\n${json}`);
      }
    }
  }

  return sections.join('\n\n');
}
