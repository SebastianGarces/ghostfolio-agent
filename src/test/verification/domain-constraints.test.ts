import { describe, expect, it } from 'bun:test';

import {
  SAFE_FALLBACK_RESPONSE,
  checkDomainConstraints
} from '../../server/verification/domain-constraints';

describe('checkDomainConstraints', () => {
  it('passes for a clean analytical response', () => {
    const response = `Your portfolio is well-diversified with 60% equities and 40% bonds.

*This analysis is for informational purposes only and does not constitute financial advice.*`;

    const result = checkDomainConstraints(response);

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.modifiedResponse).toBe(response);
  });

  it('flags "buy AAPL" as a buy/sell violation', () => {
    const response =
      'Based on your portfolio, you should buy AAPL to increase tech exposure.';

    const result = checkDomainConstraints(response);

    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.rule === 'no-buy-sell-recommendations')
    ).toBe(true);
    expect(
      result.violations.find((v) => v.rule === 'no-buy-sell-recommendations')
        ?.severity
    ).toBe('error');
  });

  it('flags "sell your bonds" as a buy/sell violation', () => {
    const response =
      'I recommend selling your bonds since they are underperforming.';

    const result = checkDomainConstraints(response);

    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.rule === 'no-buy-sell-recommendations')
    ).toBe(true);
  });

  it('flags "will return 15%" as a prediction violation', () => {
    const response =
      'Your portfolio will return 15% over the next year based on current trends.';

    const result = checkDomainConstraints(response);

    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.rule === 'no-return-predictions')
    ).toBe(true);
    expect(
      result.violations.find((v) => v.rule === 'no-return-predictions')
        ?.severity
    ).toBe('error');
  });

  it('appends disclaimer when discussing portfolio data without one', () => {
    const response =
      'Your portfolio has a net worth of $38,951 with 3 holdings.';

    const result = checkDomainConstraints(response);

    expect(
      result.violations.some((v) => v.rule === 'disclaimer-required')
    ).toBe(true);
    expect(
      result.violations.find((v) => v.rule === 'disclaimer-required')?.severity
    ).toBe('warning');
    expect(result.modifiedResponse).toContain('informational purposes only');
    // Warning-only violations still pass
    expect(result.passed).toBe(true);
  });

  it('does not append disclaimer when one already exists', () => {
    const response = `Your portfolio allocation is 60% stocks, 40% bonds.

*This analysis is for informational purposes only and does not constitute financial advice.*`;

    const result = checkDomainConstraints(response);

    expect(result.violations).toHaveLength(0);
    expect(result.modifiedResponse).toBe(response);
  });

  it('does not require disclaimer for non-portfolio responses', () => {
    const response = 'Hello! How can I help you today?';

    const result = checkDomainConstraints(response);

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.modifiedResponse).toBe(response);
  });

  it('flags "price will reach" as a prediction violation', () => {
    const response = 'AAPL price will reach $250 by end of year.';

    const result = checkDomainConstraints(response);

    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.rule === 'no-return-predictions')
    ).toBe(true);
  });

  it('flags "consider buying" as a buy/sell violation', () => {
    const response = 'You might consider buying more index funds to diversify.';

    const result = checkDomainConstraints(response);

    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.rule === 'no-buy-sell-recommendations')
    ).toBe(true);
  });

  it('can have both buy/sell and prediction violations', () => {
    const response = 'You should buy AAPL now. It will return 20% this year.';

    const result = checkDomainConstraints(response);

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(3); // buy/sell + prediction + missing disclaimer
    expect(
      result.violations.some((v) => v.rule === 'no-buy-sell-recommendations')
    ).toBe(true);
    expect(
      result.violations.some((v) => v.rule === 'no-return-predictions')
    ).toBe(true);
    expect(
      result.violations.some((v) => v.rule === 'disclaimer-required')
    ).toBe(true);
  });

  describe('off-topic detection (Rule 4)', () => {
    it('flags medical advice as off-topic', () => {
      const response =
        'For a cold, the standard medication includes acetaminophen for fever and a decongestant for symptoms.';

      const result = checkDomainConstraints(response);

      expect(result.passed).toBe(false);
      expect(
        result.violations.some((v) => v.rule === 'no-off-topic-content')
      ).toBe(true);
    });

    it('flags cooking recipes as off-topic', () => {
      const response =
        'To make pasta, boil water, add the ingredient noodles, and cook for 8 minutes. A great recipe!';

      const result = checkDomainConstraints(response);

      expect(result.passed).toBe(false);
      expect(
        result.violations.some((v) => v.rule === 'no-off-topic-content')
      ).toBe(true);
    });

    it('flags programming help as off-topic', () => {
      const response =
        'Here is a Python script that sorts a list using the bubble sort algorithm.';

      const result = checkDomainConstraints(response);

      expect(result.passed).toBe(false);
      expect(
        result.violations.some((v) => v.rule === 'no-off-topic-content')
      ).toBe(true);
    });

    it('does NOT flag financial analysis as off-topic', () => {
      const response = `Your portfolio allocation is 60% equities, 30% bonds, and 10% cash. The overall return this year is 12.5%.

*This analysis is for informational purposes only and does not constitute financial advice.*`;

      const result = checkDomainConstraints(response);

      expect(
        result.violations.some((v) => v.rule === 'no-off-topic-content')
      ).toBe(false);
      expect(result.passed).toBe(true);
    });

    it('does NOT flag "healthcare stocks" as off-topic (financial context)', () => {
      const response = `Your portfolio includes healthcare stocks like JNJ and PFE. These holdings represent 15% of your equity allocation.

*This analysis is for informational purposes only and does not constitute financial advice.*`;

      const result = checkDomainConstraints(response);

      expect(
        result.violations.some((v) => v.rule === 'no-off-topic-content')
      ).toBe(false);
      expect(result.passed).toBe(true);
    });

    it('flags travel advice as off-topic', () => {
      const response =
        'For your vacation, I recommend visiting Paris. The best tourist spots are the Eiffel Tower and the Louvre.';

      const result = checkDomainConstraints(response);

      expect(result.passed).toBe(false);
      expect(
        result.violations.some((v) => v.rule === 'no-off-topic-content')
      ).toBe(true);
    });
  });

  describe('SAFE_FALLBACK_RESPONSE', () => {
    it('is exported and contains expected text', () => {
      expect(SAFE_FALLBACK_RESPONSE).toContain(
        'Ghostfolio portfolio assistant'
      );
      expect(SAFE_FALLBACK_RESPONSE).toContain(
        'portfolio analysis and investment-related questions'
      );
    });
  });
});
