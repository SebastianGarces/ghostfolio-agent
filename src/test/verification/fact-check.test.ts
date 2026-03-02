import { describe, expect, test } from 'bun:test';

import type { ContentBlock } from '../../server/graph/content-blocks';
import { ContentBlockSchema } from '../../server/graph/content-blocks';
import type { ToolCallRecord } from '../../server/graph/state';
import {
  computeScores,
  deduplicateClaims,
  extractClaimsFromBlocks,
  factCheck,
  findBestMatch,
  findTopMatches,
  verifyClaim
} from '../../server/verification/fact-check';
import {
  type SourceDataIndex,
  buildSourceDataIndex
} from '../../server/verification/source-data-index';

// ---------------------------------------------------------------------------
// Helper to create a ContentBlock with all defaults filled in by Zod.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function block(partial: Record<string, any>): ContentBlock {
  return ContentBlockSchema.parse(partial);
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_TOOL_CALLS: ToolCallRecord[] = [
  {
    name: 'portfolio_analysis',
    success: true,
    data: {
      holdings: [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          allocation: 0.355,
          value: 13827,
          netPerformance: 3827,
          netPerformancePercent: 0.245,
          assetClass: 'EQUITY'
        },
        {
          symbol: 'VTI',
          name: 'Vanguard Total Stock Market ETF',
          allocation: 0.445,
          value: 17333,
          netPerformance: 2333,
          netPerformancePercent: 0.155,
          assetClass: 'EQUITY'
        },
        {
          symbol: 'BND',
          name: 'Vanguard Total Bond Market ETF',
          allocation: 0.2,
          value: 7791,
          netPerformance: -209,
          netPerformancePercent: -0.024,
          assetClass: 'FIXED_INCOME'
        }
      ],
      summary: {
        currentNetWorth: 38951,
        totalInvestment: 33500,
        netPerformance: 5451,
        netPerformancePercent: 0.162,
        dividend: 370.25,
        fees: 85.5
      }
    }
  }
];

// ---------------------------------------------------------------------------
// buildSourceDataIndex
// ---------------------------------------------------------------------------

describe('buildSourceDataIndex', () => {
  test('indexes portfolio_analysis data correctly', () => {
    const index = buildSourceDataIndex(SAMPLE_TOOL_CALLS);

    expect(index.amounts.get('net worth')).toBe(38951);
    expect(index.amounts.get('total investment')).toBe(33500);
    expect(index.amounts.get('net performance')).toBe(5451);
    expect(index.amounts.get('fees')).toBe(85.5);
    expect(index.amounts.get('aapl value')).toBe(13827);

    expect(index.percentages.get('aapl allocation')).toBeCloseTo(35.5);
    expect(index.percentages.get('vti allocation')).toBeCloseTo(44.5);
    expect(index.percentages.get('bnd allocation')).toBeCloseTo(20.0);
    expect(index.percentages.get('aapl performance')).toBeCloseTo(24.5);
    expect(index.percentages.get('net performance')).toBeCloseTo(16.2);

    // Derived asset-class aggregates
    expect(index.percentages.get('equity allocation')).toBeCloseTo(80.0);
    expect(index.percentages.get('fixed_income allocation')).toBeCloseTo(20.0);

    expect(index.symbols.has('AAPL')).toBe(true);
    expect(index.symbols.has('VTI')).toBe(true);
    expect(index.symbols.has('BND')).toBe(true);
    expect(index.symbols.has('TSLA')).toBe(false);

    expect(index.counts.get('holdings')).toBe(3);
  });

  test('indexes performance_report data', () => {
    const index = buildSourceDataIndex([
      {
        name: 'performance_report',
        success: true,
        data: {
          metrics: {
            currentNetWorth: 50000,
            totalInvestment: 40000,
            netPerformance: 10000,
            netPerformancePercent: 0.25,
            annualizedPercent: 0.12
          }
        }
      }
    ]);

    expect(index.amounts.get('net worth')).toBe(50000);
    expect(index.percentages.get('net performance')).toBeCloseTo(25.0);
    expect(index.percentages.get('annualized performance')).toBeCloseTo(12.0);
  });

  test('indexes risk_assessment data', () => {
    const index = buildSourceDataIndex([
      {
        name: 'risk_assessment',
        success: true,
        data: {
          statistics: { rulesPassed: 7, rulesTotal: 10 }
        }
      }
    ]);

    expect(index.counts.get('rules passed')).toBe(7);
    expect(index.counts.get('rules total')).toBe(10);
  });

  test('indexes investment_history data', () => {
    const index = buildSourceDataIndex([
      {
        name: 'investment_history',
        success: true,
        data: {
          totalInvested: 25000,
          streaks: { current: 8, longest: 12 }
        }
      }
    ]);

    expect(index.amounts.get('total invested')).toBe(25000);
    expect(index.counts.get('current streak')).toBe(8);
    expect(index.counts.get('longest streak')).toBe(12);
  });

  test('indexes dividend_analysis data', () => {
    const index = buildSourceDataIndex([
      {
        name: 'dividend_analysis',
        success: true,
        data: { totalDividends: 1500 }
      }
    ]);

    expect(index.amounts.get('total dividends')).toBe(1500);
  });

  test('indexes market_data_lookup data', () => {
    const index = buildSourceDataIndex([
      {
        name: 'market_data_lookup',
        success: true,
        data: {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          price: 185.5,
          currency: 'USD'
        }
      }
    ]);

    expect(index.symbols.has('AAPL')).toBe(true);
    expect(index.amounts.get('aapl price')).toBe(185.5);
    expect(index.amounts.get('price')).toBe(185.5);
  });

  test('indexes multi-symbol market_data_lookup data', () => {
    const index = buildSourceDataIndex([
      {
        name: 'market_data_lookup',
        success: true,
        data: {
          type: 'market_data_lookup',
          results: [
            { symbol: 'TSLA', name: 'Tesla', price: 402.51, currency: 'USD' },
            { symbol: 'AAPL', name: 'Apple', price: 264.18, currency: 'USD' },
            {
              symbol: 'GOOGL',
              name: 'Alphabet',
              price: 311.76,
              currency: 'USD'
            }
          ]
        }
      }
    ]);

    expect(index.symbols.has('TSLA')).toBe(true);
    expect(index.symbols.has('AAPL')).toBe(true);
    expect(index.symbols.has('GOOGL')).toBe(true);
    expect(index.amounts.get('tsla price')).toBe(402.51);
    expect(index.amounts.get('aapl price')).toBe(264.18);
    expect(index.amounts.get('googl price')).toBe(311.76);
    // Multi-symbol should not set generic 'price' key
    expect(index.amounts.has('price')).toBe(false);
  });

  test('indexes holdings_search data', () => {
    const index = buildSourceDataIndex([
      {
        name: 'holdings_search',
        success: true,
        data: {
          holdings: [
            { symbol: 'AAPL', name: 'Apple' },
            { symbol: 'VTI', name: 'Vanguard' }
          ]
        }
      }
    ]);

    expect(index.symbols.has('AAPL')).toBe(true);
    expect(index.symbols.has('VTI')).toBe(true);
    expect(index.counts.get('matches')).toBe(2);
  });

  test('skips failed tool calls', () => {
    const index = buildSourceDataIndex([
      { name: 'portfolio_analysis', success: false },
      {
        name: 'market_data_lookup',
        success: true,
        data: { symbol: 'VTI', price: 220, currency: 'USD' }
      }
    ]);

    expect(index.symbols.has('VTI')).toBe(true);
    expect(index.amounts.has('net worth')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findBestMatch (context matching)
// ---------------------------------------------------------------------------

describe('findBestMatch', () => {
  const keys = [
    'aapl allocation',
    'vti allocation',
    'bnd allocation',
    'net worth',
    'total investment',
    'aapl performance'
  ];

  test('finds exact match', () => {
    const result = findBestMatch('net worth', keys);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('net worth');
  });

  test('finds fuzzy match', () => {
    const result = findBestMatch('AAPL allocation percentage', keys);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('aapl allocation');
  });

  test('boosts matches with symbol', () => {
    const result = findBestMatch('allocation', keys, 'AAPL');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('aapl allocation');
  });

  test('returns null for no match', () => {
    const result = findBestMatch('something completely unrelated xyz', keys);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findTopMatches
// ---------------------------------------------------------------------------

describe('findTopMatches', () => {
  const keys = [
    'aapl allocation',
    'vti allocation',
    'bnd allocation',
    'net worth',
    'total investment',
    'aapl performance'
  ];

  test('returns multiple candidates sorted by score', () => {
    const results = findTopMatches('allocation', keys, 'AAPL');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].key).toBe('aapl allocation');
    // Scores should be in descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  test('returns empty array when no match', () => {
    const results = findTopMatches('something completely unrelated xyz', keys);
    expect(results).toEqual([]);
  });

  test('respects topN parameter', () => {
    const results = findTopMatches('allocation', keys, null, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test('applies symbol boosting', () => {
    const results = findTopMatches('allocation', keys, 'VTI');
    expect(results[0].key).toBe('vti allocation');
  });
});

// ---------------------------------------------------------------------------
// verifyClaim
// ---------------------------------------------------------------------------

describe('verifyClaim', () => {
  const index: SourceDataIndex = {
    amounts: new Map([
      ['net worth', 38951],
      ['total investment', 33500],
      ['aapl value', 13827]
    ]),
    percentages: new Map([
      ['aapl allocation', 35.5],
      ['vti allocation', 44.5],
      ['net performance', 16.2]
    ]),
    symbols: new Set(['AAPL', 'VTI', 'BND']),
    counts: new Map([
      ['current streak', 8],
      ['holdings', 3]
    ]),
    allAmountValues: new Set([38951, 33500, 13827]),
    allPercentageValues: new Set([35.5, 44.5, 16.2]),
    allCountValues: new Set([8, 3])
  };

  test('amount match within 1% tolerance', () => {
    const result = verifyClaim(
      {
        type: 'amount',
        value: 38951,
        context: 'net worth',
        symbol: null,
        text: null
      },
      index
    );
    expect(result.verdict).toBe('match');
  });

  test('amount match with small rounding', () => {
    const result = verifyClaim(
      {
        type: 'amount',
        value: 39000,
        context: 'net worth',
        symbol: null,
        text: null
      },
      index
    );
    // 39000 vs 38951 = 0.13% difference — within 1%
    expect(result.verdict).toBe('match');
  });

  test('amount mismatch beyond tolerance', () => {
    const result = verifyClaim(
      {
        type: 'amount',
        value: 40000,
        context: 'net worth',
        symbol: null,
        text: null
      },
      index
    );
    // 40000 vs 38951 = 2.7% — beyond 1%
    expect(result.verdict).toBe('mismatch');
    expect(result.actual).toBe(38951);
  });

  test('amount not in source', () => {
    const result = verifyClaim(
      {
        type: 'amount',
        value: 5000,
        context: 'annual bonus xyz',
        symbol: null,
        text: null
      },
      index
    );
    expect(result.verdict).toBe('not_in_source');
  });

  test('percentage match within 1pp tolerance', () => {
    const result = verifyClaim(
      {
        type: 'percentage',
        value: 35,
        context: 'AAPL allocation',
        symbol: 'AAPL',
        text: null
      },
      index
    );
    // 35 vs 35.5 = 0.5pp — within 1pp
    expect(result.verdict).toBe('match');
  });

  test('percentage mismatch beyond 1pp', () => {
    const result = verifyClaim(
      {
        type: 'percentage',
        value: 40,
        context: 'AAPL allocation',
        symbol: 'AAPL',
        text: null
      },
      index
    );
    expect(result.verdict).toBe('mismatch');
    expect(result.actual).toBe(35.5);
  });

  test('count exact match', () => {
    const result = verifyClaim(
      {
        type: 'count',
        value: 8,
        context: 'current streak',
        symbol: null,
        text: null
      },
      index
    );
    expect(result.verdict).toBe('match');
  });

  test('count mismatch', () => {
    const result = verifyClaim(
      {
        type: 'count',
        value: 10,
        context: 'current streak',
        symbol: null,
        text: null
      },
      index
    );
    expect(result.verdict).toBe('mismatch');
  });

  test('symbol found in source', () => {
    const result = verifyClaim(
      {
        type: 'symbol',
        symbol: 'AAPL',
        context: 'holding',
        value: null,
        text: null
      },
      index
    );
    expect(result.verdict).toBe('match');
  });

  test('symbol not found in source', () => {
    const result = verifyClaim(
      {
        type: 'symbol',
        symbol: 'TSLA',
        context: 'holding',
        value: null,
        text: null
      },
      index
    );
    expect(result.verdict).toBe('mismatch');
  });

  test('assertion is unverifiable', () => {
    const result = verifyClaim(
      {
        type: 'assertion',
        text: 'beaten the S&P 500',
        context: 'benchmark',
        value: null,
        symbol: null
      },
      index
    );
    expect(result.verdict).toBe('unverifiable');
  });
});

// ---------------------------------------------------------------------------
// verifyClaim — multi-candidate matching
// ---------------------------------------------------------------------------

describe('verifyClaim multi-candidate', () => {
  test('amount: matches alternative candidate when best candidate mismatches', () => {
    const index: SourceDataIndex = {
      amounts: new Map([
        ['total investment', 25000],
        ['total invested', 33500],
        ['net worth', 38951]
      ]),
      percentages: new Map(),
      symbols: new Set(),
      counts: new Map(),
      allAmountValues: new Set([25000, 33500, 38951]),
      allPercentageValues: new Set(),
      allCountValues: new Set()
    };

    const result = verifyClaim(
      {
        type: 'amount',
        value: 33500,
        context: 'total investment',
        symbol: null,
        text: null
      },
      index
    );

    expect(result.verdict).toBe('match');
  });

  test('percentage: matches alternative candidate when best mismatches', () => {
    const index: SourceDataIndex = {
      amounts: new Map(),
      percentages: new Map([
        ['net performance', 25.0],
        ['overall return', 16.2]
      ]),
      symbols: new Set(),
      counts: new Map(),
      allAmountValues: new Set(),
      allPercentageValues: new Set([25.0, 16.2]),
      allCountValues: new Set()
    };

    const result = verifyClaim(
      {
        type: 'percentage',
        value: 16.0,
        context: 'overall return on portfolio',
        symbol: null,
        text: null
      },
      index
    );

    expect(result.verdict).toBe('match');
  });

  test('count: matches alternative candidate', () => {
    const index: SourceDataIndex = {
      amounts: new Map(),
      percentages: new Map(),
      symbols: new Set(),
      counts: new Map([
        ['holdings', 5],
        ['positions', 3]
      ]),
      allAmountValues: new Set(),
      allPercentageValues: new Set(),
      allCountValues: new Set([5, 3])
    };

    const result = verifyClaim(
      {
        type: 'count',
        value: 3,
        context: 'portfolio positions',
        symbol: null,
        text: null
      },
      index
    );

    expect(result.verdict).toBe('match');
  });

  test('amount: reports mismatch when no candidate matches', () => {
    const index: SourceDataIndex = {
      amounts: new Map([
        ['total investment', 25000],
        ['total invested', 26000]
      ]),
      percentages: new Map(),
      symbols: new Set(),
      counts: new Map(),
      allAmountValues: new Set([25000, 26000]),
      allPercentageValues: new Set(),
      allCountValues: new Set()
    };

    const result = verifyClaim(
      {
        type: 'amount',
        value: 33500,
        context: 'total investment',
        symbol: null,
        text: null
      },
      index
    );

    expect(result.verdict).toBe('mismatch');
  });
});

// ---------------------------------------------------------------------------
// verifyClaim — value-existence fallback (key collision recovery)
// ---------------------------------------------------------------------------

describe('verifyClaim key collision recovery', () => {
  test('hp-007: dividend_analysis value recovered after portfolio_analysis overwrites key', () => {
    // Simulates: dividend_analysis sets 'dividends' → 683.50, then
    // portfolio_analysis sets 'dividends' → 370.25 (last writer wins in map)
    const index: SourceDataIndex = {
      amounts: new Map([
        ['dividends', 370.25], // portfolio_analysis won the key
        ['dividend', 370.25],
        ['dividend income', 370.25],
        ['total dividends', 683.5]
      ]),
      percentages: new Map(),
      symbols: new Set(),
      counts: new Map(),
      allAmountValues: new Set([370.25, 683.5]), // both values preserved
      allPercentageValues: new Set(),
      allCountValues: new Set()
    };

    const result = verifyClaim(
      {
        type: 'amount',
        value: 683.5,
        context: 'total dividend income received',
        symbol: null,
        text: null
      },
      index
    );

    expect(result.verdict).toBe('match');
    expect(result.actual).toBe(683.5);
  });

  test('edge-005: net performance value found via fallback when context matches wrong key', () => {
    // Simulates: claim says "$5,420 net performance" but context matching
    // picks "net worth" ($38,951) instead — fallback finds 5420 in allAmountValues
    const index: SourceDataIndex = {
      amounts: new Map([
        ['net worth', 38951],
        ['net performance', 5420]
      ]),
      percentages: new Map(),
      symbols: new Set(),
      counts: new Map(),
      allAmountValues: new Set([38951, 5420]),
      allPercentageValues: new Set(),
      allCountValues: new Set()
    };

    // Use a noisy context that might confuse context matching
    const result = verifyClaim(
      {
        type: 'amount',
        value: 5420,
        context: 'your net performance is worth $5,420',
        symbol: null,
        text: null
      },
      index
    );

    expect(result.verdict).toBe('match');
  });

  test('fallback does not match when value truly absent', () => {
    const index: SourceDataIndex = {
      amounts: new Map([['net worth', 38951]]),
      percentages: new Map(),
      symbols: new Set(),
      counts: new Map(),
      allAmountValues: new Set([38951]),
      allPercentageValues: new Set(),
      allCountValues: new Set()
    };

    const result = verifyClaim(
      {
        type: 'amount',
        value: 99999,
        context: 'net worth',
        symbol: null,
        text: null
      },
      index
    );

    expect(result.verdict).toBe('mismatch');
  });
});

// ---------------------------------------------------------------------------
// deduplicateClaims
// ---------------------------------------------------------------------------

describe('deduplicateClaims', () => {
  test('removes regex-sourced claim when metric-sourced claim for same value exists', () => {
    const claims = [
      // Metric-sourced: short context, no $
      {
        type: 'amount' as const,
        value: 683.5,
        context: 'Total Dividends',
        symbol: null,
        text: null
      },
      // Regex-sourced: long context with $
      {
        type: 'amount' as const,
        value: 683.5,
        context: 'received a total of $683.50 in dividend',
        symbol: null,
        text: null
      }
    ];

    const result = deduplicateClaims(claims);
    expect(result).toHaveLength(1);
    expect(result[0].context).toBe('Total Dividends');
  });

  test('keeps both claims when values differ', () => {
    const claims = [
      {
        type: 'amount' as const,
        value: 683.5,
        context: 'Total Dividends',
        symbol: null,
        text: null
      },
      {
        type: 'amount' as const,
        value: 370.25,
        context: 'received a total of $370.25 in dividend',
        symbol: null,
        text: null
      }
    ];

    const result = deduplicateClaims(claims);
    expect(result).toHaveLength(2);
  });

  test('keeps regex-sourced claim when no metric-sourced equivalent', () => {
    const claims = [
      {
        type: 'amount' as const,
        value: 5420,
        context: 'your portfolio has earned $5,420 in net',
        symbol: null,
        text: null
      }
    ];

    const result = deduplicateClaims(claims);
    expect(result).toHaveLength(1);
  });

  test('deduplicates percentage claims the same way', () => {
    const claims = [
      {
        type: 'percentage' as const,
        value: 16.2,
        context: 'Net Performance',
        symbol: null,
        text: null
      },
      {
        type: 'percentage' as const,
        value: 16.2,
        context:
          'Your portfolio has achieved an overall return of 16.2% on your investments this year',
        symbol: null,
        text: null
      }
    ];

    const result = deduplicateClaims(claims);
    expect(result).toHaveLength(1);
    expect(result[0].context).toBe('Net Performance');
  });
});

// ---------------------------------------------------------------------------
// computeScores
// ---------------------------------------------------------------------------

describe('computeScores', () => {
  test('perfect scores when all claims match', () => {
    const result = computeScores([
      {
        claim: {
          type: 'amount',
          value: 38951,
          context: 'net worth',
          symbol: null,
          text: null
        },
        verdict: 'match',
        actual: 38951,
        detail: 'ok'
      },
      {
        claim: {
          type: 'symbol',
          symbol: 'AAPL',
          context: 'holding',
          value: null,
          text: null
        },
        verdict: 'match',
        detail: 'ok'
      }
    ]);

    expect(result.hallucination.passed).toBe(true);
    expect(result.hallucination.issues).toHaveLength(0);
    expect(result.groundedness.accuracy.score).toBe(1.0);
    expect(result.groundedness.precision.score).toBe(1.0);
    expect(result.groundedness.overall).toBe(1.0);
  });

  test('zero accuracy with all numeric mismatches', () => {
    const result = computeScores([
      {
        claim: {
          type: 'amount',
          value: 100000,
          context: 'net worth',
          symbol: null,
          text: null
        },
        verdict: 'mismatch',
        actual: 38951,
        detail: 'wrong'
      },
      {
        claim: {
          type: 'percentage',
          value: 50,
          context: 'allocation',
          symbol: 'AAPL',
          text: null
        },
        verdict: 'mismatch',
        actual: 35.5,
        detail: 'wrong'
      }
    ]);

    expect(result.groundedness.accuracy.score).toBe(0);
    expect(result.hallucination.passed).toBe(false);
    expect(result.hallucination.issues).toHaveLength(2);
  });

  test('unverifiable claims get 0.5 weight in groundedness', () => {
    const result = computeScores([
      {
        claim: {
          type: 'assertion',
          text: 'test',
          context: 'test',
          value: null,
          symbol: null
        },
        verdict: 'unverifiable',
        detail: 'cannot verify'
      }
    ]);

    expect(result.groundedness.groundedness.score).toBe(0.5);
  });

  test('not_in_source claims do not count as mismatches for numeric', () => {
    const result = computeScores([
      {
        claim: {
          type: 'amount',
          value: 5000,
          context: 'unknown',
          symbol: null,
          text: null
        },
        verdict: 'not_in_source',
        detail: 'not found'
      },
      {
        claim: {
          type: 'amount',
          value: 38951,
          context: 'net worth',
          symbol: null,
          text: null
        },
        verdict: 'match',
        actual: 38951,
        detail: 'ok'
      }
    ]);

    // Only 1 checkable numeric claim (the match), accuracy = 1.0
    expect(result.groundedness.accuracy.score).toBe(1.0);
  });

  test('symbol not_in_source generates hallucination issue', () => {
    const result = computeScores([
      {
        claim: {
          type: 'symbol',
          symbol: 'TSLA',
          context: 'holding',
          value: null,
          text: null
        },
        verdict: 'not_in_source',
        detail: 'TSLA not found'
      }
    ]);

    expect(result.hallucination.passed).toBe(false);
    expect(result.hallucination.issues[0].type).toBe('symbol_not_in_data');
  });

  test('empty claims returns default perfect scores', () => {
    const result = computeScores([]);
    expect(result.groundedness.accuracy.score).toBe(1.0);
    expect(result.groundedness.precision.score).toBe(1.0);
    expect(result.groundedness.overall).toBe(1.0);
    expect(result.hallucination.passed).toBe(true);
  });

  test('mixed verdicts compute weighted overall correctly', () => {
    const result = computeScores([
      {
        claim: {
          type: 'amount',
          value: 38951,
          context: 'net worth',
          symbol: null,
          text: null
        },
        verdict: 'match',
        actual: 38951,
        detail: 'ok'
      },
      {
        claim: {
          type: 'percentage',
          value: 50,
          context: 'allocation',
          symbol: 'AAPL',
          text: null
        },
        verdict: 'mismatch',
        actual: 35.5,
        detail: 'wrong'
      },
      {
        claim: {
          type: 'symbol',
          symbol: 'AAPL',
          context: 'holding',
          value: null,
          text: null
        },
        verdict: 'match',
        detail: 'ok'
      },
      {
        claim: {
          type: 'symbol',
          symbol: 'TSLA',
          context: 'holding',
          value: null,
          text: null
        },
        verdict: 'mismatch',
        detail: 'not found'
      }
    ]);

    // accuracy: 1 match / 2 checkable = 0.5
    // precision: 1 match / 2 checkable = 0.5
    // groundedness: 2 match / 4 checkable = 0.5
    // overall = 0.5*0.40 + 0.5*0.35 + 0.5*0.25 = 0.50
    expect(result.groundedness.accuracy.score).toBe(0.5);
    expect(result.groundedness.precision.score).toBe(0.5);
    expect(result.groundedness.groundedness.score).toBe(0.5);
    expect(result.groundedness.overall).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// extractClaimsFromBlocks
// ---------------------------------------------------------------------------

describe('extractClaimsFromBlocks', () => {
  test('extracts amount from metric block with dollar value', () => {
    const blocks = [
      block({ type: 'metric', label: 'Net Worth', value: '$38,951' })
    ];
    const claims = extractClaimsFromBlocks(blocks);

    expect(claims.length).toBe(1);
    expect(claims[0].type).toBe('amount');
    expect(claims[0].value).toBe(38951);
    expect(claims[0].context).toBe('Net Worth');
  });

  test('extracts percentage from metric block', () => {
    const blocks = [
      block({
        type: 'metric',
        label: 'AAPL Allocation',
        value: '35.5%'
      })
    ];
    const claims = extractClaimsFromBlocks(blocks);

    expect(claims.length).toBe(1);
    expect(claims[0].type).toBe('percentage');
    expect(claims[0].value).toBe(35.5);
    expect(claims[0].context).toBe('AAPL Allocation');
    expect(claims[0].symbol).toBe('AAPL');
  });

  test('extracts claims from metric_row block', () => {
    const blocks = [
      block({
        type: 'metric_row',
        metrics: [
          {
            label: 'Net Worth',
            value: '$38,951',
            format: 'currency',
            sentiment: null
          },
          {
            label: 'Performance',
            value: '16.2%',
            format: 'percentage',
            sentiment: 'positive'
          }
        ]
      })
    ];
    const claims = extractClaimsFromBlocks(blocks);

    expect(claims.length).toBe(2);
    expect(claims[0].type).toBe('amount');
    expect(claims[0].value).toBe(38951);
    expect(claims[1].type).toBe('percentage');
    expect(claims[1].value).toBe(16.2);
  });

  test('extracts symbol from symbol block', () => {
    const blocks = [
      block({ type: 'symbol', symbol: 'AAPL', name: 'Apple Inc.' })
    ];
    const claims = extractClaimsFromBlocks(blocks);

    expect(claims.length).toBe(1);
    expect(claims[0].type).toBe('symbol');
    expect(claims[0].symbol).toBe('AAPL');
    expect(claims[0].context).toBe('Apple Inc.');
  });

  test('extracts claims from text blocks via regex fallback', () => {
    const blocks = [
      block({
        type: 'text',
        style: 'paragraph',
        value: 'Your portfolio is worth $38,951 with 16.2% returns.'
      })
    ];
    const claims = extractClaimsFromBlocks(blocks);

    expect(claims.length).toBe(2);
    expect(claims.some((c) => c.type === 'amount' && c.value === 38951)).toBe(
      true
    );
    expect(
      claims.some((c) => c.type === 'percentage' && c.value === 16.2)
    ).toBe(true);
  });

  test('extracts claims from list blocks via regex fallback', () => {
    const blocks = [
      block({
        type: 'list',
        items: ['AAPL — $13,827 (35.5%)', 'VTI — $17,333 (44.5%)']
      })
    ];
    const claims = extractClaimsFromBlocks(blocks);

    // Should find dollar amounts and percentages
    expect(claims.some((c) => c.type === 'amount')).toBe(true);
    expect(claims.some((c) => c.type === 'percentage')).toBe(true);
  });

  test('skips data-reference blocks (no claims to extract)', () => {
    const blocks = [
      block({ type: 'holdings_table', source: 'portfolio_analysis' }),
      block({ type: 'area_chart', source: 'performance_report' })
    ];
    const claims = extractClaimsFromBlocks(blocks);

    expect(claims.length).toBe(0);
  });

  test('handles plain number metric values', () => {
    const blocks = [
      block({ type: 'metric', label: 'Total Invested', value: '33500' })
    ];
    const claims = extractClaimsFromBlocks(blocks);

    expect(claims.length).toBe(1);
    expect(claims[0].type).toBe('amount');
    expect(claims[0].value).toBe(33500);
  });

  test('returns empty array for empty blocks', () => {
    const claims = extractClaimsFromBlocks([]);
    expect(claims).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// factCheck (integration — deterministic block extraction)
// ---------------------------------------------------------------------------

describe('factCheck', () => {
  test('returns default pass when no tool calls', async () => {
    const result = await factCheck('Hello!', [], []);

    expect(result.hallucination.passed).toBe(true);
    expect(result.groundedness.overall).toBe(1.0);
  });

  test('returns default pass when all tool calls failed', async () => {
    const result = await factCheck(
      'Some response',
      [{ name: 'portfolio_analysis', success: false }],
      []
    );

    expect(result.hallucination.passed).toBe(true);
    expect(result.groundedness.overall).toBe(1.0);
  });

  test('returns default pass when no claims extracted from blocks', async () => {
    const blocks = [
      block({
        type: 'text',
        style: 'paragraph',
        value: 'Your portfolio looks good.'
      })
    ];
    const result = await factCheck(
      'Your portfolio looks good.',
      SAMPLE_TOOL_CALLS,
      blocks
    );

    expect(result.hallucination.passed).toBe(true);
    expect(result.groundedness.overall).toBe(1.0);
  });

  test('correctly verifies matching claims from metric blocks', async () => {
    const blocks = [
      block({
        type: 'text',
        style: 'title',
        value: 'Portfolio Overview'
      }),
      block({
        type: 'metric',
        label: 'Net Worth',
        value: '$38,951',
        format: 'currency'
      }),
      block({
        type: 'symbol',
        symbol: 'AAPL',
        name: 'Apple Inc.'
      })
    ];
    const result = await factCheck(
      'Net Worth: $38,951\nAAPL (Apple Inc.)',
      SAMPLE_TOOL_CALLS,
      blocks
    );

    expect(result.hallucination.passed).toBe(true);
    expect(result.groundedness.accuracy.score).toBe(1.0);
    expect(result.groundedness.precision.score).toBe(1.0);
  });

  test('detects mismatching symbol claims from blocks', async () => {
    const blocks = [
      block({
        type: 'symbol',
        symbol: 'AAPL',
        name: 'Apple Inc.'
      }),
      block({
        type: 'symbol',
        symbol: 'TSLA',
        name: 'Tesla Inc.'
      })
    ];
    const result = await factCheck(
      'AAPL (Apple Inc.)\nTSLA (Tesla Inc.)',
      SAMPLE_TOOL_CALLS,
      blocks
    );

    expect(result.hallucination.passed).toBe(false);
    const tslaIssue = result.hallucination.issues.find(
      (i) => i.type === 'symbol_not_in_data'
    );
    expect(tslaIssue).toBeDefined();
    expect(tslaIssue!.claimed).toBe('TSLA');
  });

  test('falls back to regex extraction when blocks are empty', async () => {
    const result = await factCheck(
      'Your portfolio is worth $38,951.',
      SAMPLE_TOOL_CALLS,
      []
    );

    // Regex should extract $38,951 as an amount claim
    expect(result.hallucination.passed).toBe(true);
    expect(result.groundedness.accuracy.score).toBe(1.0);
  });

  test('handles percentage rounding correctly (35% vs 35.5%)', async () => {
    const blocks = [
      block({
        type: 'metric',
        label: 'AAPL Allocation',
        value: '35%'
      })
    ];
    const result = await factCheck(
      'AAPL Allocation: 35%',
      SAMPLE_TOOL_CALLS,
      blocks
    );

    // 35 vs 35.5 = 0.5pp — within 1pp tolerance
    expect(result.hallucination.passed).toBe(true);
    expect(result.groundedness.accuracy.score).toBe(1.0);
  });

  test('handles dollar amount formatting differences ($33,500 vs 33500)', async () => {
    const blocks = [
      block({
        type: 'metric',
        label: 'Total Investment',
        value: '$33,500'
      })
    ];
    const result = await factCheck(
      'Total Investment: $33,500',
      SAMPLE_TOOL_CALLS,
      blocks
    );

    expect(result.hallucination.passed).toBe(true);
    expect(result.groundedness.accuracy.score).toBe(1.0);
  });
});
