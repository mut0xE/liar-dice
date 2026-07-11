import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { useGames } from "../hooks/useGames";
import { useGameActions } from "../hooks/useGameActions";
import { pushToast } from "../ui/toast";

const FEE_CHIPS = [0.01, 0.05, 0.1, 0.25];
const TIMER_CHIPS = [30, 60, 90, 120];

export function NewVoyage() {
  const navigate = useNavigate();
  const wallet = useAnchorWallet();
  const { busy, create } = useGameActions();
  const { refresh } = useGames();

  const [entryFee, setEntryFee] = useState(0.01);
  const [customFee, setCustomFee] = useState(false);
  const [customFeeText, setCustomFeeText] = useState("");
  const [graceSeconds, setGraceSeconds] = useState(60);

  if (!wallet) return null;
  const creating = busy === "create";

  // Lamports are indivisible below 1e-9 SOL; cap keeps a typo from escrowing a fortune.
  const parsedCustom = Number(customFeeText);
  const customValid =
    customFeeText !== "" && Number.isFinite(parsedCustom) && parsedCustom >= 0.000000001 && parsedCustom <= 100;
  const effectiveFee = customFee ? (customValid ? parsedCustom : null) : entryFee;

  const onCreate = async () => {
    if (effectiveFee === null) return;
    try {
      const addr = await create(effectiveFee, graceSeconds);
      await refresh();
      navigate(`/table/${addr}`, { replace: true });
    } catch (e) {
      pushToast({ kind: "error", label: "Create failed", detail: (e as Error).message });
    }
  };

  return (
    <main className="screen new-voyage">
      <div className="ribbon rise d1"><div className="band">New Voyage</div></div>

      <div className="parchment create-form rise d2">
        <div className="disp form-title">Chart the table</div>

        <div className="lbl">Entry fee</div>
        <div className="chips">
          {FEE_CHIPS.map((f) => (
            <button
              key={f}
              className={`chip${!customFee && entryFee === f ? " on" : ""}`}
              onClick={() => {
                setCustomFee(false);
                setEntryFee(f);
              }}
            >
              {f} ◎
            </button>
          ))}
          <button className={`chip${customFee ? " on" : ""}`} onClick={() => setCustomFee(true)}>
            Custom
          </button>
        </div>
        {customFee && (
          <div className="custom-fee">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.01}
              placeholder="0.5"
              autoFocus
              value={customFeeText}
              onChange={(e) => setCustomFeeText(e.target.value)}
              aria-label="Custom entry fee in SOL"
            />
            <span className="custom-fee-unit">◎</span>
            {customFeeText !== "" && !customValid && (
              <div className="field-hint custom-fee-hint">Enter between 0.000000001 and 100 SOL</div>
            )}
          </div>
        )}

        <div className="lbl" style={{ marginTop: 12 }}>Turn timer</div>
        <div className="chips">
          {TIMER_CHIPS.map((t) => (
            <button key={t} className={`chip${graceSeconds === t ? " on" : ""}`} onClick={() => setGraceSeconds(t)}>
              {t}s
            </button>
          ))}
        </div>

        <div className="form-actions">
          <button className="btn btn-dim btn-sm" onClick={() => navigate(-1)} disabled={creating}>
            Cancel
          </button>
          <button className="btn btn-green btn-sm" onClick={onCreate} disabled={creating || effectiveFee === null}>
            {creating ? "Setting sail…" : "Lock In & Set Sail"}
          </button>
        </div>
        <div className="mono escrow-note">Your wallet will be prompted · SOL held in escrow</div>
      </div>
    </main>
  );
}
