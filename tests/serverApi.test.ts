import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/server/app.ts';

describe('Express API & PayPal Agent Toolkit Integration', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  before(async () => {
    const { app } = createApp();
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
  });

  after(async () => {
    await closeServer();
  });

  it('exposes honest zero-config LOCAL_SANDBOX_REPLAY health and 47 @paypal/agent-toolkit tools', async () => {
    const healthResp = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResp.status, 200);
    const health = (await healthResp.json()) as {
      ok: boolean;
      gateway: { executionMode: string; toolkitToolCount: number };
    };
    assert.equal(health.ok, true);
    assert.equal(health.gateway.executionMode, 'LOCAL_SANDBOX_REPLAY');
    assert.equal(health.gateway.toolkitToolCount, 47);

    const toolsResp = await fetch(`${baseUrl}/api/paypal/tools`);
    assert.equal(toolsResp.status, 200);
    const toolsJson = (await toolsResp.json()) as { tools: Array<{ name: string }> };
    assert.equal(toolsJson.tools.length, 47);
    assert.ok(toolsJson.tools.some((t) => t.name === 'create_order'));
    assert.ok(toolsJson.tools.some((t) => t.name === 'accept_dispute_claim'));
  });

  it('blocks policy-violating execution until explicit override and records honest WireLog on settle', async () => {
    // 1. Reset state cleanly
    await fetch(`${baseUrl}/api/ledger/reset`, { method: 'POST' });

    // 2. Attempt executing duplicate-flagged row-006 -> must return 409 Conflict
    const blockedResp = await fetch(`${baseUrl}/api/ledger/row-006/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceOverride: false }),
    });
    assert.equal(blockedResp.status, 409);

    // 3. Approve override + execute create_invoice via gateway
    const approveResp = await fetch(`${baseUrl}/api/ledger/row-006/approve`, { method: 'POST' });
    assert.equal(approveResp.status, 200);

    const execResp = await fetch(`${baseUrl}/api/ledger/row-006/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceOverride: false }),
    });
    assert.equal(execResp.status, 200);
    const execJson = (await execResp.json()) as {
      ok: boolean;
      item: { status: string; paypalResourceId: string; executionMode: string };
      wireEntry: { executionMode: string; toolName: string };
    };
    assert.equal(execJson.ok, true);
    assert.equal(execJson.item.status, 'SETTLED_PAYPAL');
    assert.equal(execJson.item.executionMode, 'LOCAL_SANDBOX_REPLAY');
    assert.equal(execJson.wireEntry.toolName, 'create_invoice');
    assert.ok(execJson.item.paypalResourceId.startsWith('INV2-SBX-'));
  });

  it('ingests new text, skips blocked rows during batch payout, and re-scores dynamically on cap change', async () => {
    await fetch(`${baseUrl}/api/ledger/reset`, { method: 'POST' });

    // Ingest new contractor payout
    const ingestResp = await fetch(`${baseUrl}/api/ai/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Pay Vikram Rao <vikram@sandbox.example.com> $750 USD for SDK integration tests.',
      }),
    });
    assert.equal(ingestResp.status, 201);
    const ingestJson = (await ingestResp.json()) as { added: Array<{ id: string; amountUsd: number; status: string }> };
    assert.equal(ingestJson.added.length, 1);
    assert.equal(ingestJson.added[0].amountUsd, 750);
    assert.equal(ingestJson.added[0].status, 'APPROVED');

    // Run batch payout selecting approved row-001 + blocked row-009 -> must skip row-009!
    const batchResp = await fetch(`${baseUrl}/api/ledger/batch-payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: ['row-001', 'row-009', ingestJson.added[0].id] }),
    });
    assert.equal(batchResp.status, 200);
    const batchJson = (await batchResp.json()) as {
      dispatchedCount: number;
      skippedBlockedIds: string[];
    };
    assert.equal(batchJson.dispatchedCount, 2);
    assert.deepEqual(batchJson.skippedBlockedIds, ['row-009']);

    // Lower cap to $500 -> pending/approved $890 & $640 should trigger spend-cap evaluation
    const policyResp = await fetch(`${baseUrl}/api/ledger/policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxAutoApproveUsd: 500 }),
    });
    assert.equal(policyResp.status, 200);
    const state = (await policyResp.json()) as { items: Array<{ id: string; riskFactors: Array<{ code: string }> }> };
    const row2 = state.items.find((i) => i.id === 'row-002');
    assert.ok(row2?.riskFactors.some((f) => f.code === 'EXCEEDS_AUTO_APPROVE_CAP'));
  });
});
