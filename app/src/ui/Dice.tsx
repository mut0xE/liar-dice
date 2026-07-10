export function Dice({ value, delay = 0, highlight = false, wild = false, mini = false }: { value: number; delay?: number; highlight?: boolean; wild?: boolean; mini?: boolean }) {
  const pipsByFace: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const pips = new Set(pipsByFace[Math.max(1, Math.min(6, Number(value)))] ?? []);
  return (
    <div className={`die${mini ? " mini" : ""}${highlight ? " match" : ""}${wild ? " wild" : ""}`} data-face={value} style={{ animationDelay: `${delay}ms` }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span className={pips.has(i) ? "pip on" : "pip"} key={i} />
      ))}
      {wild && <span className="wild-tag">wild</span>}
    </div>
  );
}
