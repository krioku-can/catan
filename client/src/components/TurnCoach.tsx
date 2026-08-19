import type { ReactNode } from 'react';

/** Always-visible one-line coach under the top bar. */
export default function TurnCoach({
  text,
  highlight,
  trailing,
}: {
  text: string;
  highlight?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div
      className="turn-coach"
      style={{
        ...styles.bar,
        ...(highlight ? styles.highlight : null),
      }}
      role="status"
      aria-live="polite"
    >
      <span style={styles.text}>{text}</span>
      {trailing}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '8px 12px',
    paddingLeft: 'max(12px, env(safe-area-inset-left))',
    paddingRight: 'max(12px, env(safe-area-inset-right))',
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.35,
    color: '#e8ecf4',
    background: 'linear-gradient(180deg, #3a2412 0%, #2a1810 100%)',
    borderBottom: '1px solid rgba(200,150,70,0.28)',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  highlight: {
    background: 'linear-gradient(180deg, #1b4332 0%, #2d6a4f 100%)',
    borderBottomColor: '#40916c',
    color: '#d8f3dc',
    boxShadow: '0 0 0 1px rgba(64,145,108,0.35) inset',
  },
};
