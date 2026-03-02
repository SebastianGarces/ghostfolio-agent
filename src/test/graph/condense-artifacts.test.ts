import { describe, expect, test } from 'bun:test';

import { condenseArtifacts } from '../../server/graph/condense-artifacts';
import type { ToolCallRecord } from '../../server/graph/state';

describe('condenseArtifacts', () => {
  test('condenses portfolio_analysis', () => {
    const calls: ToolCallRecord[] = [
      {
        name: 'portfolio_analysis',
        success: true,
        data: {
          holdings: [
            {
              symbol: 'AAPL',
              name: 'Apple Inc.',
              allocation: 0.5,
              netPerformancePercent: 0.25,
              assetClass: 'EQUITY'
            },
            {
              symbol: 'BND',
              name: 'Bond Fund',
              allocation: 0.3,
              netPerformancePercent: 0.05,
              assetClass: 'FIXED_INCOME'
            }
          ],
          summary: {
            currentNetWorth: 100000,
            totalInvestment: 80000,
            netPerformance: 20000,
            netPerformancePercent: 0.25
          }
        }
      }
    ];
    const result = condenseArtifacts(calls);
    expect(result).toContain('[portfolio_analysis]');
    expect(result).toContain('Net worth: 100000');
    expect(result).toContain('AAPL');
    expect(result).toContain('50.0%');
  });

  test('condenses performance_report', () => {
    const calls: ToolCallRecord[] = [
      {
        name: 'performance_report',
        success: true,
        data: {
          metrics: {
            currentNetWorth: 50000,
            totalInvestment: 40000,
            netPerformance: 10000
          }
        }
      }
    ];
    const result = condenseArtifacts(calls);
    expect(result).toContain('[performance_report]');
    expect(result).toContain('Net worth: 50000');
  });

  test('condenses risk_assessment', () => {
    const calls: ToolCallRecord[] = [
      {
        name: 'risk_assessment',
        success: true,
        data: {
          statistics: { rulesPassed: 5, rulesTotal: 7 },
          categories: [
            {
              rules: [
                { name: 'Diversification', passed: true },
                { name: 'Concentration', passed: false }
              ]
            }
          ]
        }
      }
    ];
    const result = condenseArtifacts(calls);
    expect(result).toContain('Passed: 5/7');
    expect(result).toContain('Concentration');
  });

  test('condenses dividend_analysis', () => {
    const calls: ToolCallRecord[] = [
      {
        name: 'dividend_analysis',
        success: true,
        data: { totalDividends: 1500 }
      }
    ];
    const result = condenseArtifacts(calls);
    expect(result).toContain('Total dividends: 1500');
  });

  test('condenses market_data_lookup', () => {
    const calls: ToolCallRecord[] = [
      {
        name: 'market_data_lookup',
        success: true,
        data: { name: 'Apple', symbol: 'AAPL', price: 180, currency: 'USD' }
      }
    ];
    const result = condenseArtifacts(calls);
    expect(result).toContain('Apple');
    expect(result).toContain('price=180');
  });

  test('condenses holdings_search', () => {
    const calls: ToolCallRecord[] = [
      {
        name: 'holdings_search',
        success: true,
        data: {
          holdings: [
            { symbol: 'AAPL', name: 'Apple' },
            { symbol: 'MSFT', name: 'Microsoft' }
          ]
        }
      }
    ];
    const result = condenseArtifacts(calls);
    expect(result).toContain('Matches (2)');
    expect(result).toContain('AAPL');
  });

  test('condenses investment_history', () => {
    const calls: ToolCallRecord[] = [
      {
        name: 'investment_history',
        success: true,
        data: {
          totalInvested: 60000,
          streaks: { current: 6, longest: 12 }
        }
      }
    ];
    const result = condenseArtifacts(calls);
    expect(result).toContain('Total invested: 60000');
    expect(result).toContain('current streak: 6 months');
  });

  test('investment_history includes both current and longest streak', () => {
    const calls: ToolCallRecord[] = [
      {
        name: 'investment_history',
        success: true,
        data: {
          totalInvested: 50000,
          streaks: { current: 3, longest: 10 }
        }
      }
    ];
    const result = condenseArtifacts(calls);
    expect(result).toContain('current streak: 3 months');
    expect(result).toContain('longest streak: 10 months');
  });

  test('skips failed tool calls', () => {
    const calls: ToolCallRecord[] = [
      { name: 'portfolio_analysis', success: false },
      {
        name: 'dividend_analysis',
        success: true,
        data: { totalDividends: 500 }
      }
    ];
    const result = condenseArtifacts(calls);
    expect(result).not.toContain('portfolio_analysis');
    expect(result).toContain('Total dividends: 500');
  });

  test('returns empty string for no successful calls', () => {
    const calls: ToolCallRecord[] = [
      { name: 'portfolio_analysis', success: false }
    ];
    const result = condenseArtifacts(calls);
    expect(result).toBe('');
  });
});
