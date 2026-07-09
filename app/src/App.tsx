import { useWallet } from "@solana/wallet-adapter-react";
import { Connect } from "./screens/Connect";

export function App() {
  const { connected } = useWallet();
  if (!connected) return <Connect />;
  return <Connect />; // replaced by Lobby in Task 3
}
