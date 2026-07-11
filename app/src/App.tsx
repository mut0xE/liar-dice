import { BrowserRouter, Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connect } from "./screens/Connect";
import { Home } from "./screens/Home";
import { Games } from "./screens/Games";
import { NewVoyage } from "./screens/NewVoyage";
import { WaitingRoom } from "./screens/WaitingRoom";
import { Play } from "./screens/Play";
import { WalletButton } from "./wallet/WalletButton";
import { Toaster } from "./ui/Toaster";

export function App() {
  const { publicKey } = useWallet();
  if (!publicKey) return <><Connect /><Toaster /></>;

  return (
    <BrowserRouter>
      <AppHeader />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/games" element={<Games />} />
        <Route path="/games/new" element={<NewVoyage />} />
        <Route path="/table/:addr" element={<WaitingRoom />} />
        <Route path="/play/:addr" element={<Play />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const atHome = location.pathname === "/";
  const atTable = location.pathname.startsWith("/play/");
  // Back walks UP the screen hierarchy, never through raw history — history can
  // hold dead states (a "table not found" flash, a stale setup screen) that
  // replaying would resurrect.
  const backTo = atTable || location.pathname.startsWith("/table/") || location.pathname.startsWith("/games/")
    ? "/games"
    : "/";
  return (
    <header className={`app-header${atTable ? " on-table" : ""}`}>
      {!atHome ? (
        <button className="back-btn" onClick={() => navigate(backTo)} aria-label="Back">
          <span className="back-arrow">‹</span> Back
        </button>
      ) : (
        <span />
      )}
      <WalletButton />
    </header>
  );
}
