export function Dice({ value, delay = 0 }: { value: number; delay?: number }) {
  const pips = Array.from({ length: value });
  return (
    <div className="die" style={{ animationDelay: `${delay}ms` }}>
      {pips.map((_, i) => (
        <span className="pip" key={i} />
      ))}
    </div>
  );
}
