import 'dotenv/config';
import { createApp } from './server/app.ts';

const port = Number(process.env.PORT ?? 8787);
const { app, gateway } = createApp();

app.listen(port, () => {
  const status = gateway.getStatus();
  console.log(
    `[PayFlow Agentic Ledger] API ready on http://localhost:${port} | Mode: ${status.executionMode} | @paypal/agent-toolkit tools: ${status.toolkitToolCount}`
  );
});
