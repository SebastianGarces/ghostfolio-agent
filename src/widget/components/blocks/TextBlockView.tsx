import React from 'react';

interface TextBlockViewProps {
  style: 'title' | 'subtitle' | 'paragraph' | 'caption' | 'label';
  value: string;
}

const styleMap: Record<string, React.CSSProperties> = {
  title: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#fff',
    margin: '4px 0'
  },
  subtitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.85)',
    margin: '2px 0'
  },
  paragraph: {
    fontSize: '13px',
    lineHeight: '1.5',
    color: 'rgba(255,255,255,0.85)',
    margin: '2px 0'
  },
  caption: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
    margin: '2px 0'
  },
  label: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    margin: '2px 0'
  }
};

export function TextBlockView({ style, value }: TextBlockViewProps) {
  return <div style={styleMap[style] ?? styleMap.paragraph}>{value}</div>;
}
