import React from 'react';

// Helper to parse inline bolding (**text**) within a string
function parseBold(text: string): React.ReactNode[] {
  const parts = text.split('**');
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return <strong key={i}>{part}</strong>;
    }
    return part;
  });
}

/**
 * ponytail: A zero-dependency, lightweight, JSX-based markdown parser
 * that supports bolding, headers, and bullet points without using dangerous HTML injection.
 * Uses custom flex layouts for lists to override browser CSS overrides and resets.
 */
export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const lines = text.split('\n');
  return (
    <div className="markdown-body">
      {lines.map((line, index) => {
        const trimmed = line.trim();

        // Header 3 (###)
        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={index} style={{ margin: '1.2rem 0 0.6rem 0', fontSize: '1.1rem', fontWeight: 'bold' }}>
              {trimmed.slice(4)}
            </h3>
          );
        }

        // Header 4 (####)
        if (trimmed.startsWith('#### ')) {
          return (
            <h4 key={index} style={{ margin: '1rem 0 0.5rem 0', fontSize: '1rem', fontWeight: 'bold' }}>
              {trimmed.slice(5)}
            </h4>
          );
        }

        // Bullet List Items (* or - or •)
        const bulletMatch = trimmed.match(/^([\*\-•])\s(.*)/);
        if (bulletMatch) {
          const content = bulletMatch[2];
          return (
            <div key={index} style={{ display: 'flex', gap: '0.5rem', marginBlock: '0.35rem', paddingLeft: '1.25rem', textAlign: 'justify', lineHeight: '1.5' }}>
              <span style={{ userSelect: 'none', opacity: 0.8 }}>•</span>
              <div style={{ flexGrow: 1 }}>{parseBold(content)}</div>
            </div>
          );
        }

        // Numbered List Items (e.g. 1. or 2.)
        const numberedMatch = trimmed.match(/^(\d+)\.\s(.*)/);
        if (numberedMatch) {
          const num = numberedMatch[1];
          const content = numberedMatch[2];
          return (
            <div key={index} style={{ display: 'flex', gap: '0.6rem', marginBlock: '0.45rem', paddingLeft: '0.2rem', textAlign: 'justify', lineHeight: '1.5' }}>
              <span style={{ fontWeight: 'bold', minWidth: '1.1rem', userSelect: 'none' }}>{num}.</span>
              <div style={{ flexGrow: 1 }}>{parseBold(content)}</div>
            </div>
          );
        }

        // Empty spacer lines
        if (trimmed === '') {
          return <div key={index} style={{ height: '0.6rem' }} />;
        }

        // Standard paragraphs
        return (
          <p key={index} style={{ margin: '0.4rem 0', textAlign: 'justify', lineHeight: '1.5' }}>
            {parseBold(trimmed)}
          </p>
        );
      })}
    </div>
  );
}
