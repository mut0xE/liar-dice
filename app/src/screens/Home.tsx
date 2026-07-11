import { useNavigate } from "react-router-dom";

export function Home() {
  const navigate = useNavigate();
  return (
    <main className="screen home" aria-label="Liar's Dice">
      <section className="home-titlewrap rise d1">
        <p className="home-eyebrow">Bluff for real SOL</p>
        <h1 className="home-wordmark">
          LIAR'S<br />DICE
        </h1>
        <p className="home-tag">Out-bluff the table. Last cup standing takes the pot.</p>
      </section>

      <div className="home-powered rise d2">
        <span className="home-powered-k">Powered by</span>
        <img className="home-powered-logo" src="/magicblock-logo.webp" alt="MagicBlock" />
      </div>

      <div className="home-dock rise d3">
        <button className="btn btn-green btn-lg" onClick={() => navigate("/games/new")}>
          New game
        </button>
        <button className="btn btn-blue btn-lg" onClick={() => navigate("/games")}>
          Open waters
        </button>
      </div>
    </main>
  );
}
