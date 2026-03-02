import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import React from 'react';

interface RuleStatusViewProps {
  statistics: { rulesPassed: number; rulesTotal: number };
  categories: Array<{
    name: string;
    rules: Array<{ name: string; passed: boolean; evaluation: string }>;
  }>;
}

const scoreBadgeStyle = (ratio: number): React.CSSProperties => ({
  display: 'inline-block',
  padding: '4px 12px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
  color: '#fff',
  backgroundColor:
    ratio >= 0.8
      ? 'rgba(74, 222, 128, 0.2)'
      : ratio >= 0.5
        ? 'rgba(245, 158, 11, 0.2)'
        : 'rgba(239, 68, 68, 0.2)',
  border: `1px solid ${
    ratio >= 0.8
      ? 'rgba(74, 222, 128, 0.4)'
      : ratio >= 0.5
        ? 'rgba(245, 158, 11, 0.4)'
        : 'rgba(239, 68, 68, 0.4)'
  }`,
  marginBottom: '12px'
});

const categoryRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '4px 0',
  fontSize: '13px'
};

function CategoryIcon({ passed, total }: { passed: number; total: number }) {
  const iconProps = {
    size: 14,
    style: { flexShrink: 0 } as React.CSSProperties
  };

  if (passed === total) return <CheckCircle {...iconProps} color="#4ade80" />;
  if (passed === 0) return <XCircle {...iconProps} color="#ef4444" />;
  return <AlertCircle {...iconProps} color="#f59e0b" />;
}

export function RuleStatusView({
  statistics,
  categories
}: RuleStatusViewProps) {
  const ratio =
    statistics.rulesTotal > 0
      ? statistics.rulesPassed / statistics.rulesTotal
      : 0;

  const categoryStats = categories.map((cat) => ({
    name: cat.name,
    passed: cat.rules.filter((r) => r.passed).length,
    total: cat.rules.length
  }));

  return (
    <div>
      <div style={scoreBadgeStyle(ratio)}>
        {statistics.rulesPassed}/{statistics.rulesTotal} rules passed
      </div>
      {categoryStats.map((cat) => (
        <div key={cat.name} style={categoryRowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CategoryIcon passed={cat.passed} total={cat.total} />
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>{cat.name}</span>
          </div>
          <span
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: '12px',
              flexShrink: 0
            }}
          >
            {cat.passed}/{cat.total}
          </span>
        </div>
      ))}
    </div>
  );
}
