import { useEffect, useState } from "react";

const RULES: { head: string; points: string[] }[] = [
  {
    head: "Setup",
    points: [
      "Pay in — your SOL sits safe in escrow.",
      "Roll 5 dice in secret. Only you see yours.",
      "Miss the roll window twice in a row and you're struck out.",
    ],
  },
  {
    head: "Bidding",
    points: [
      "Guess how many dice show a face — count the whole table.",
      "1s count as any face, unless the bid is on 1s.",
      "Every bid must beat the last: more dice, or a higher face.",
      "Don't believe it? Call “Liar!”",
    ],
  },
  {
    head: "Showdown",
    points: [
      "Hands flip. Bid true, bidder wins — challenger loses a die.",
      "Bid false, bidder loses a die instead.",
      "Out of dice, you're out.",
      "Take too long and anyone can force your move.",
    ],
  },
  {
    head: "Winning",
    points: ["Last sailor holding dice takes the pot."],
  },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        className="help-btn"
        onClick={() => setOpen(true)}
        aria-label="How to play"
        aria-haspopup="dialog"
      >
        ?
      </button>

      {open && (
        <div className="rules-overlay" onClick={() => setOpen(false)}>
          <div className="scroll" role="dialog" aria-modal="true" aria-label="How to play" onClick={(e) => e.stopPropagation()}>
            <div className="scroll-roll" />

            <div className="scroll-sheet">
              <button className="rules-close" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
              <div className="disp rules-title">Ship's Rules</div>
              <div className="rules-body">
                {RULES.map((section) => (
                  <div className="rules-section" key={section.head}>
                    <div className="rules-head">{section.head}</div>
                    <ul className="rules-list">
                      {section.points.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="scroll-roll" />
          </div>
        </div>
      )}
    </>
  );
}
