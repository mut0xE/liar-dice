# Liar's Dice

A multiplayer Liar's Dice game on Solana, built with Anchor and MagicBlock
Ephemeral Rollups. Gameplay moves (roll, bid, challenge, reveal) run on an
Ephemeral Rollup for instant, wallet-popup-free turns; game creation and
payouts settle on Solana devnet.

See [docs/architecture.md](docs/architecture.md) for how the program, the
rollup, and the frontend fit together.

## Project layout

```
programs/liar-dice/   Anchor program (instructions, accounts, errors)
app/                  React frontend (Vite)
tests/                Anchor integration tests
migrations/           Anchor deploy script
docs/                 Architecture documentation
```

## Requirements

- Rust + Anchor CLI 
- Node.js and Yarn
- A Solana devnet RPC provider 

## Setup

Install dependencies:

```bash
yarn install
cd app && yarn install
```

Copy the example env files and fill in your own RPC key:

```bash
cp .env.example .env
cp app/.env.example app/.env
```

## Building and testing the program

```bash
anchor build
anchor test
```

Individual test suites:

```bash
yarn test:flow      # full game flow
yarn test:guards    # error/guard cases
yarn test:stall     # timeout handling
```

## Running the frontend

```bash
cd app
yarn dev
```

## Program ID

```
1iAR1JYBJsjtzS6jSLbUfVbYuBfR88FpxbNPKUE6nLb
```

Deployed to Solana devnet, `[programs.devnet]` in `Anchor.toml`.
