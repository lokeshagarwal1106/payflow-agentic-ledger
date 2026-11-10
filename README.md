# PayFlow Agentic Ledger

> **Autonomous, Policy-Guarded PayPal Treasury & Payout Copilot** built with the official [`@paypal/agent-toolkit`](https://www.npmjs.com/package/@paypal/agent-toolkit), PayPal Sandbox REST APIs, Zero-Billing Local AI Parsing & Guardrails, and **AG Grid v36**.

---

## Why PayFlow Agentic Ledger?

Freelancers, indie SaaS founders, and lean finance operators receive contractor payout requests, B2B invoices, customer refunds, and PayPal disputes across messy email and chat threads. Automating disbursements with naive AI agents is risky—a single duplicate invoice or urgent wire message can drain funds before anyone notices.

**PayFlow Agentic Ledger** puts a deterministic, explainable policy firewall and an interactive **AG Grid v36** financial control plane between unstructured requests and **PayPal Sandbox execution**:

1. **Zero-Billing Unstructured AI Ingest (`POST /api/ai/ingest`)**
   - Parses raw contractor emails, invoices, checkout requests, refunds, and PayPal disputes into structured ledger items at **$0 / ₹0 API cost**.
   - Automatically detects whether browser on-device Prompt AI is available and never requires paid external LLM API billing.
2. **5-Factor Anomaly, Fraud & Spend-Cap Firewall (`src/shared/riskEngine.ts`)**
   - **`DUPLICATE_PAYEE_AMOUNT`**: Detects repeat billing for the same counterparty & amount within active ledger history (`+45` risk pts).
   - **`SPLIT_STRUCTURING`**: Flags concurrent requests split under the autonomous spend cap whose cumulative sum exceeds the limit (`+35` risk pts).
   - **`EXCEEDS_AUTO_APPROVE_CAP`**: Blocks disbursements exceeding the live policy slider (`$500` – `$2,500`).
   - **`URGENCY_BYPASS_SIGNAL`**: Catches prompt-injection/social-engineering phrases (`"skip approval"`, `"wire immediately"`, `"bypass"`).
   - **`EMAIL_DOMAIN_ANOMALY`**: Flags invalid emails or high-value unverified webmail transfers.
3. **Natural Language → AG Grid `FilterModel` Compiler (`POST /api/ai/compile-filter`)**
   - Type plain English like `"high risk blocked payouts over 500"` or `"orders between 300 and 1500 solstice"`.
   - Compiles your query into a genuine **AG Grid v36 `FilterModel`** JSON (`filterType: 'number' | 'text'`, `operator`, `inRange`, `greaterThan`, `lessThan`) plus `quickFilterText`, displays the compiled AST inline, and drives live KPI rollups over visible filtered rows.
4. **Official `@paypal/agent-toolkit` (`47 Tools`) + Dual Execution Modes (`src/server/paypalGateway.ts`)**
   - Inspects and validates plans against real **`@paypal/agent-toolkit/ai-sdk`** Zod schemas (`create_order`, `create_invoice`, `accept_dispute_claim`, `create_refund`, `list_disputes`, `list_transactions`, etc.) plus PayPal Batch Payouts REST v1 (`/v1/payments/payouts`).
   - **Mode A — `LOCAL_SANDBOX_REPLAY` ($0 / Offline Ready):** Runs immediately out-of-the-box with zero credentials, validating every payload against official PayPal toolkit schemas and emitting traceable Wire Log envelopes clearly tagged `LOCAL_SANDBOX_REPLAY`.
   - **Mode B — `LIVE_SANDBOX_API`:** Paste free Sandbox Client ID & Secret from `https://developer.paypal.com/dashboard/` via the **Sandbox Keys** modal (held in session memory only) or `.env` to execute live HTTP requests against `https://api-m.sandbox.paypal.com`.

---

## AG Grid v36 Feature Integration

Built cleanly with `ag-grid-react` + `ag-grid-community` (`36.3.0`) using the Quartz dark financial theme (`themeQuartz.withPart(colorSchemeDarkBlue)`):

- **AI-Driven Column FilterModel Control:** `gridApi.setFilterModel(...)` + `onFilterChanged` syncing filtered totals to the top KPI ribbon.
- **Multi-Row Batch Payout Selection:** `rowSelection={{ mode: 'multiRow', checkboxes: true }}` computing selected payout totals while automatically skipping policy-blocked items on batch dispatch.
- **Custom React Cell Renderers & Inline Editing:** Status pills, Risk Score badges with anomaly tooltips, double-click editable `costCenter` & `notes` columns persisted via `PATCH /api/ledger/:id`, plus 1-click PayPal action / human-override buttons and **CSV Export** (`gridApi.exportDataAsCsv()`).

---

## Quick Start (Local Run Instructions for Judges)

**Prerequisites:** Node.js `>= 20` and `npm`.

```bash
# 1. Clone and install dependencies
npm install

# 2. Run typecheck + production frontend bundle (Vite + TypeScript)
npm run build

# 3. Run unit & API integration tests
npm test

# 4. Start the full-stack server (serves UI + API on port 8787)
npm start
```

Open **`http://localhost:8787`** in your browser.

### Optional: Connecting Free PayPal Developer Sandbox Credentials

1. Log into [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) (free account, Sandbox mode).
2. Under **Apps & Credentials -> Sandbox**, copy a **Client ID** and **Secret**.
3. Either set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env` (see `.env.example`), **or** click **Sandbox Keys** in the top navigation bar at runtime to verify OAuth2 (`POST /v1/oauth2/token`) and switch the live mode badge to **`LIVE PAYPAL SANDBOX API`**.

---

## Project Structure

```text
├── src/
│   ├── shared/
│   │   ├── types.ts                # Shared domain contracts & wire envelopes
│   │   ├── riskEngine.ts           # Deterministic 5-factor anomaly & policy firewall
│   │   ├── aiParser.ts             # Zero-cost unstructured email parser & PayPal tool planner
│   │   ├── nlToAgGridFilter.ts     # Natural Language -> AG Grid FilterModel compiler
│   │   └── seedData.ts             # Synthetic demo scenarios (zero PII)
│   ├── server/
│   │   ├── paypalGateway.ts        # @paypal/agent-toolkit (47 tools) + Live/Replay Sandbox gateway
│   │   ├── ledgerStore.ts          # Ledger state, policy enforcement & batch payout orchestrator
│   │   └── app.ts                  # Express 5 REST API + static Vite bundle server
│   ├── client/
│   │   ├── App.tsx                 # Main workspace orchestration
│   │   └── components/             # TopBar, KpiRibbon, AiCopilotPanel, LedgerGrid, WireInspector, CredentialsModal
│   └── server.ts                   # HTTP entrypoint (PORT=8787)
├── tests/
│   ├── riskAndAi.test.ts           # Unit tests: AI parser, fraud guardrails, AG Grid compiler, Zod toolkit check
│   └── serverApi.test.ts           # HTTP integration tests against Express app
├── postman/
│   └── paypal-agentic-ledger.postman_collection.json
├── render.yaml
└── LICENSE                         # MIT Open Source License
```

---

## Transparent AI Co-Engineering Disclosure

- **Development Method:** This project was scoped, directed, reviewed, and submitted by an individual developer using the **Google Antigravity** AI coding agent, which implemented the TypeScript/React/Express codebase, AG Grid integration, `@paypal/agent-toolkit` wiring, automated tests, and demo video rendering under explicit human constraints (zero external API billing, zero PII, original MIT-compatible code, and verified sandbox tests).
- **Runtime Honest Execution:** When no PayPal Sandbox credentials are configured, transactions execute in `LOCAL_SANDBOX_REPLAY` mode and are visibly labeled as replay outputs in both the UI and Wire Log—never disguised as live PayPal responses.

---

## License

Released under the [MIT License](./LICENSE).
