interface GameLogProps {
  log: string[];
}

export default function GameLog({ log }: GameLogProps) {
  return (
    <div style={styles.container}>
      <div style={styles.header}>Game Log</div>
      <div style={styles.logArea}>
        {log.slice(-20).map((msg, i) => (
          <div key={i} style={styles.entry}>{msg}</div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#0f3460',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    fontSize: 13,
    color: '#8890a0',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  logArea: {
    fontSize: 12,
    color: '#b0b0b0',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  entry: {
    lineHeight: 1.3,
  },
};
