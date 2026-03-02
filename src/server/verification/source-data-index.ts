/**
 * Builds a typed index directly from raw ToolCallRecord[].data for
 * deterministic fact-checking. No LLM involved — just structured extraction.
 */
import type { ToolCallRecord } from '../graph/state';

export interface SourceDataIndex {
  /** Keyed by lowercase context string, e.g. "net worth" -> 38951 */
  amounts: Map<string, number>;
  /** Keyed by lowercase context string, e.g. "aapl allocation" -> 35.0 */
  percentages: Map<string, number>;
  /** All financial symbols present in source data */
  symbols: Set<string>;
  /** Keyed by lowercase context string, e.g. "current streak" -> 8 */
  counts: Map<string, number>;
  /** Every amount value inserted (survives key overwrites) */
  allAmountValues: Set<number>;
  /** Every percentage value inserted (survives key overwrites) */
  allPercentageValues: Set<number>;
  /** Every count value inserted (survives key overwrites) */
  allCountValues: Set<number>;
}

export function buildSourceDataIndex(
  toolCalls: ToolCallRecord[]
): SourceDataIndex {
  const amounts = new Map<string, number>();
  const percentages = new Map<string, number>();
  const symbols = new Set<string>();
  const counts = new Map<string, number>();
  const allAmountValues = new Set<number>();
  const allPercentageValues = new Set<number>();
  const allCountValues = new Set<number>();

  const setAmount = (key: string, value: number) => {
    amounts.set(key, value);
    allAmountValues.add(value);
  };
  const setPercentage = (key: string, value: number) => {
    percentages.set(key, value);
    allPercentageValues.add(value);
  };
  const setCount = (key: string, value: number) => {
    counts.set(key, value);
    allCountValues.add(value);
  };

  for (const tc of toolCalls) {
    if (!tc.success || !tc.data) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = tc.data as any;

    switch (tc.name) {
      case 'portfolio_analysis': {
        const holdings = (d.holdings ?? []) as Array<{
          symbol: string;
          name: string;
          allocation: number;
          value: number;
          netPerformance: number;
          netPerformancePercent: number;
          assetClass: string;
        }>;
        const s = d.summary;

        if (s) {
          setAmount('net worth', s.currentNetWorth ?? 0);
          setAmount('current net worth', s.currentNetWorth ?? 0);
          setAmount('total investment', s.totalInvestment ?? 0);
          setAmount('net performance', s.netPerformance ?? 0);
          if (s.netPerformancePercent != null) {
            setPercentage('net performance', s.netPerformancePercent * 100);
            setPercentage('overall return', s.netPerformancePercent * 100);
            setPercentage('portfolio return', s.netPerformancePercent * 100);
          }
          if (s.dividend != null) {
            setAmount('dividends', s.dividend);
            setAmount('dividend', s.dividend);
            setAmount('dividend income', s.dividend);
          }
          if (s.fees != null) {
            setAmount('fees', s.fees);
            setAmount('fees paid', s.fees);
          }
        }

        // Aggregate asset-class allocations and counts
        const assetClassAlloc = new Map<string, number>();

        for (const h of holdings) {
          symbols.add(h.symbol);

          // Per-holding amounts
          const sym = h.symbol.toLowerCase();
          setAmount(`${sym} value`, h.value ?? 0);
          setAmount(`${sym} net performance`, h.netPerformance ?? 0);
          if (h.name) {
            setAmount(`${h.name.toLowerCase()} value`, h.value ?? 0);
          }

          // Per-holding allocation percentage (stored as 0-1 in data, convert to 0-100)
          const allocPct = (h.allocation ?? 0) * 100;
          setPercentage(`${sym} allocation`, allocPct);
          setPercentage(`${sym}`, allocPct);
          if (h.name) {
            setPercentage(`${h.name.toLowerCase()} allocation`, allocPct);
          }

          // Per-holding performance percentage
          if (h.netPerformancePercent != null) {
            const perfPct = h.netPerformancePercent * 100;
            setPercentage(`${sym} performance`, perfPct);
            setPercentage(`${sym} return`, perfPct);
          }

          // Accumulate asset-class allocation
          if (h.assetClass) {
            const cls = h.assetClass.toLowerCase();
            assetClassAlloc.set(
              cls,
              (assetClassAlloc.get(cls) ?? 0) + allocPct
            );
          }
        }

        // Store derived asset-class aggregates
        for (const [cls, alloc] of assetClassAlloc) {
          setPercentage(`${cls} allocation`, alloc);
          // Common aliases
          if (cls === 'equity') {
            setPercentage('stock allocation', alloc);
            setPercentage('stocks allocation', alloc);
            setPercentage('equity allocation', alloc);
          }
          if (cls === 'fixed_income') {
            setPercentage('bond allocation', alloc);
            setPercentage('bonds allocation', alloc);
            setPercentage('fixed income allocation', alloc);
          }
          if (cls === 'cryptocurrency' || cls === 'crypto') {
            setPercentage('crypto allocation', alloc);
            setPercentage('cryptocurrency allocation', alloc);
          }
        }

        setCount('holdings', holdings.length);
        setCount('positions', holdings.length);
        break;
      }

      case 'performance_report': {
        const m = d.metrics;
        if (m) {
          setAmount('net worth', m.currentNetWorth ?? 0);
          setAmount('current net worth', m.currentNetWorth ?? 0);
          setAmount('total investment', m.totalInvestment ?? 0);
          setAmount('net performance', m.netPerformance ?? 0);
          if (m.netPerformancePercent != null) {
            setPercentage('net performance', m.netPerformancePercent * 100);
            setPercentage('overall return', m.netPerformancePercent * 100);
            setPercentage('portfolio return', m.netPerformancePercent * 100);
          }
          if (m.annualizedPercent != null) {
            setPercentage('annualized performance', m.annualizedPercent * 100);
          }
        }
        break;
      }

      case 'risk_assessment': {
        const stats = d.statistics;
        if (stats) {
          setCount('rules passed', stats.rulesPassed ?? 0);
          setCount('rules total', stats.rulesTotal ?? 0);
        }
        break;
      }

      case 'investment_history': {
        if (d.totalInvested != null) {
          setAmount('total invested', d.totalInvested);
          setAmount('total invested in period', d.totalInvested);
        }
        if (d.streaks) {
          const current = d.streaks.current ?? d.streaks.currentStreak ?? 0;
          const longest = d.streaks.longest ?? d.streaks.longestStreak ?? 0;
          setCount('current streak', current);
          setCount('longest streak', longest);
        }
        break;
      }

      case 'dividend_analysis': {
        if (d.totalDividends != null) {
          setAmount('total dividends', d.totalDividends);
          setAmount('dividend income', d.totalDividends);
          setAmount('dividends', d.totalDividends);
        }
        break;
      }

      case 'market_data_lookup': {
        // Multi-symbol response: { results: [...] }
        if (Array.isArray(d.results)) {
          for (const r of d.results) {
            const sym = (r.symbol ?? '').toUpperCase();
            if (sym) symbols.add(sym);
            const price = r.price ?? r.marketPrice;
            if (price != null) {
              setAmount(`${sym.toLowerCase()} price`, price);
            }
          }
        } else {
          // Single-symbol response
          const price = d.price ?? d.marketPrice;
          const sym = (d.symbol ?? '').toUpperCase();
          if (sym) symbols.add(sym);
          if (price != null) {
            setAmount(`${sym.toLowerCase()} price`, price);
            setAmount('price', price);
          }
        }
        break;
      }

      case 'holdings_search': {
        const holdings = d.holdings ?? [];
        for (const h of holdings) {
          if (h.symbol) symbols.add(h.symbol);
        }
        setCount('matches', holdings.length);
        setCount('search results', holdings.length);
        break;
      }
    }
  }

  return {
    amounts,
    percentages,
    symbols,
    counts,
    allAmountValues,
    allPercentageValues,
    allCountValues
  };
}
