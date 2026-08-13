/** Always-visible one-line coach under the top bar. */
export default function TurnCoach({ text, highlight }: { text: string; highlight?: boolean }) {
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
      {text}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    flexShrink: 0,
    padding: '8px 12px',
    paddingLeft: 'max(12px, env(safe-area-inset-left))',
    paddingRight: 'max(12px, env(safe-area-inset-right))',
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.35,
    color: '#e8ecf4',
    background: 'linear-gradient(180deg, #16213e 0%, #0f3460 100%)',
    borderBottom: '1px solid #1a4a7a',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  highlight: {
    background: 'linear-gradient(180deg, #1b4332 0%, #2d6a4f 100%)',
    borderBottomColor: '#40916c',
    color: '#d8f3dc',
    boxShadow: '0 0 0 1px rgba(64,145,108,0.35) inset',
  },
};
