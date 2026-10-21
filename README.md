# ShipGate

**Escrow that pays only after GenLayer validators fetch the vendor's live deliverable on-chain and independently judge that the live responses satisfy sealed acceptance checks.**

- Network: **GenLayer StudioNet** (hosted GenLayer Studio) — status is *Preview*.
- Live contract: `0x2571888A8EFF43734eb05F7421c81b8EE3098025`
- Explorer: https://explorer-studio.genlayer.com/address/0x2571888A8EFF43734eb05F7421c81b8EE3098025
- Live app: see `VITE_CONTRACT_ADDRESS` deployment on Vercel (URL in the repo's Deployments).

## Why this needs GenLayer

The decision at the center of ShipGate is *"does this deployed service actually do what was agreed?"* Answering it requires two things an ordinary smart contract cannot do: **reading an arbitrary live URL from inside the contract with no oracle**, and making a **subjective judgment** about whether the captured HTTP responses satisfy prose acceptance checks. In ShipGate both happen *inside* the Intelligent Contract via `gl.nondet.web.get` + `gl.nondet.exec_prompt`, and many validators must converge on the verdict through `gl.vm.run_nondet`. Remove the web-fetch and the LLM and nothing is left but a blind timer — the project dies.

This is **not** a GitHub-merge verifier. ShipGate deliberately checks the *running* service, which merge-based milestone tools explicitly cannot prove.

## Trust boundary

A passing review proves the sealed endpoints answered the checks **when they were fetched during consensus**. It does **not** prove permanent uptime, security, or correctness under every input. The deployer holds no privileged role: whoever calls `create_agreement` becomes the client; the vendor is sealed into immutable terms; any wallet may run the review, dispute, settle, or recover an expired agreement.

## Lifecycle

```
DRAFT → FUNDED → SUBMITTED → REVIEWED ─┬→ DISPUTED → (re-review) ─┐
                                       └────────────→ SETTLED → withdraw (PAID / REFUNDED)
funded, past expiry, unsettled → RECOVERED → client refund
```

`ACCEPTED`, `PARTIAL`, `REJECTED`, `UNREACHABLE` are bounded verdicts. **Contract code — not the model — maps them to money:** ACCEPTED pays the full escrow to the vendor; PARTIAL pays `budget × partial_bps / 10000` and refunds the rest; REJECTED and UNREACHABLE refund the client in full. `held + paid + refunded == budget` always holds. A target+paths tuple can settle only once (`used_targets`).

## Consensus design (Axis 2)

The non-deterministic block fetches each sealed probe path, then an LLM grades the live responses against the checks and returns `{outcome, matched}`. Consensus is on the **meaning** of the verdict — the `outcome` and the set of satisfied checks — not on byte-identical response bodies, which can legitimately differ between two fetches of a live service:

```python
def validator(proposal):
    if not isinstance(proposal, gl.vm.Return):
        return False
    theirs = proposal.calldata["result"]
    mine = observe()["result"]
    return theirs["outcome"] == mine["outcome"] and list(theirs["matched"]) == list(mine["matched"])
```

Any fetch failure, non-200/oversize response, malformed or out-of-vocabulary LLM JSON, or a cross-field mismatch between `matched` and `outcome` fails closed with no credit.

## Repository layout

```
contracts/Contract.py   # the Intelligent Contract (schema shipgate-v1)
src/                    # Vite + React + genlayer-js frontend
tests/test_contract.py  # gltest Direct-Mode suite (happy path + edge cases)
scripts/deploy.mjs      # StudioNet deployment
scripts/live.mjs        # multi-wallet end-to-end / seeding run
```

## Local verification

```bash
npm install --legacy-peer-deps
python3 -m pip install genlayer-test
python3 -m pytest tests -q        # 12 Direct-Mode tests
npm run test                      # frontend unit tests
npm run build                     # typecheck + production build
```

Direct Mode mocks the non-deterministic web/LLM observations; it is not live consensus.

## Deploy to StudioNet

```bash
source ~/.genlayer/env.sh         # exports GENLAYER_PRIVATE_KEY
npm run deploy                    # prints the deployed address + get_config
```

Then set `VITE_CONTRACT_ADDRESS` in `.env` and on Vercel, and redeploy the frontend.

## End-to-end / seeding

`scripts/live.mjs` drives the full lifecycle from two already-funded StudioNet wallets (client + vendor, never the deployer) against a stable public target, producing one ACCEPTED payout, one REJECTED refund, and one disputed→re-reviewed record. Never commit private keys; keys come from `~/.genlayer/env.sh`.

## Frontend

```bash
npm run dev
```

MetaMask signs; `createClient({ chain: studionet, account: userAddress })` — no secret ships in the bundle. On connect the app switches/adds the GenLayer Studio network. Review and re-review transactions show an explicit "validators are fetching the live endpoint and voting" waiting state, and the dossier renders the AI verdict, which checks passed, the observed HTTP statuses, and an Explorer link.

### Routes

The UI is split across dedicated routes (react-router), not one page:

- `/` — overview + how it judges
- `/agreements/:id` — the shipment dossier: lifecycle, live verdict, and role actions
- `/create` — seal a new agreement
- `/explorer` — every agreement on the contract, read live from StudioNet, with resolved cases, verdicts, and payouts

Each page has explicit loading / not-found / error states. `npm run e2e` drives the production build in headless Chrome against live StudioNet state (home, Explorer, detail pages, not-found, create — 8 checks).
