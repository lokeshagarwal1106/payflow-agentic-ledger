import type {
  LedgerActionType,
  LedgerItem,
  ParsedAiCandidate,
  PayPalToolCallPlan,
} from './types.ts';

function inferActionType(text: string): LedgerActionType {
  const lower = text.toLowerCase();
  if (/\b(dispute|chargeback|claim|item not received|pp-d-)\b/.test(lower)) {
    return 'DISPUTE';
  }
  if (/\b(refund|reimburse|credit note|return payment)\b/.test(lower)) {
    return 'REFUND';
  }
  if (/\b(checkout|storefront|order|subscription checkout|buy)\b/.test(lower)) {
    return 'ORDER';
  }
  if (/\b(invoice|bill|retainer|inv-|net\s?\d+|billing statement)\b/.test(lower)) {
    return 'INVOICE';
  }
  return 'PAYOUT';
}

function inferCategory(text: string, actionType: LedgerActionType): { category: string; costCenter: string } {
  const lower = text.toLowerCase();
  if (actionType === 'DISPUTE' || actionType === 'REFUND' || /\b(support|customer|refund)\b/.test(lower)) {
    return { category: 'Customer Ops', costCenter: 'CC-SUP-04' };
  }
  if (/\b(design|ui|ux|figma|brand|illustration)\b/.test(lower)) {
    return { category: 'Design & Brand', costCenter: 'CC-DSN-02' };
  }
  if (/\b(cloud|aws|gcp|render|infra|devops|kubernetes|gpu|server)\b/.test(lower)) {
    return { category: 'Cloud & Infra', costCenter: 'CC-INF-03' };
  }
  if (/\b(security|audit|pentest|soc2|compliance|legal)\b/.test(lower)) {
    return { category: 'Security & Compliance', costCenter: 'CC-SEC-05' };
  }
  return { category: 'Engineering', costCenter: 'CC-ENG-01' };
}

function extractAmountUsd(text: string): number {
  // Prefer explicit currency-prefixed amounts ($1,250.50 or USD 900)
  const currencyMatch = text.match(/(?:\$|usd\s*)([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  if (currencyMatch) {
    const parsed = Number.parseFloat(currencyMatch[1].replace(/,/g, ''));
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.round(parsed * 100) / 100;
    }
  }

  // Fallback to numbers followed by currency words
  const suffixMatch = text.match(/\b([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:usd|dollars|bucks)\b/i);
  if (suffixMatch) {
    const parsed = Number.parseFloat(suffixMatch[1].replace(/,/g, ''));
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.round(parsed * 100) / 100;
    }
  }

  return 0;
}

function extractReferenceId(text: string, actionType: LedgerActionType, idx: number): string {
  const refMatch = text.match(/\b((?:INV|PO|ORD|DSP|PP-D|REF)-[A-Z0-9-]{3,16})\b/i);
  if (refMatch) {
    return refMatch[1].toUpperCase();
  }
  const prefixMap: Record<LedgerActionType, string> = {
    PAYOUT: 'PO',
    INVOICE: 'INV',
    ORDER: 'ORD',
    DISPUTE: 'PP-D',
    REFUND: 'REF',
  };
  const suffix = String(Date.now() % 10000).padStart(4, '0');
  return `${prefixMap[actionType]}-AI-${suffix}-${idx + 1}`;
}

function extractEmail(text: string): string | null {
  const emailMatch = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  return emailMatch ? emailMatch[1].toLowerCase() : null;
}

function extractPayee(text: string, email: string | null): string {
  const explicitMatch = text.match(
    /(?:from|payee|vendor|contractor|merchant|pay|recipient|to)\s*[:\-]\s*([A-Z][A-Za-z0-9&.,' ]{2,42}?)(?=\s*(?:\(|<|\||,|—|-|for|\$|@|\n|$))/i
  );
  if (explicitMatch && explicitMatch[1].trim().length >= 2) {
    return explicitMatch[1].trim().replace(/[.,]+$/, '');
  }

  const inlinePayMatch = text.match(
    /(?:pay|send|invoice|refund|payout to)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,2})/
  );
  if (inlinePayMatch && inlinePayMatch[1].trim().length >= 2) {
    return inlinePayMatch[1].trim();
  }

  if (email) {
    const localPart = email.split('@')[0];
    return localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  return 'Unassigned Sandbox Payee';
}

function splitCandidateSegments(rawText: string): string[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }
  // Split blank-line separated blocks or explicit bullet/numbered lines when each looks like a distinct transaction.
  const paragraphBlocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const segments: string[] = [];
  for (const block of paragraphBlocks) {
    const lines = block
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);

    const linesWithAmounts = lines.filter((l) => extractAmountUsd(l) > 0);
    if (lines.length > 1 && linesWithAmounts.length >= 2) {
      segments.push(...linesWithAmounts);
    } else {
      segments.push(block);
    }
  }
  return segments;
}

export function parseUnstructuredMessages(rawText: string): ParsedAiCandidate[] {
  const segments = splitCandidateSegments(rawText);
  const candidates: ParsedAiCandidate[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const amountUsd = extractAmountUsd(segment);
    if (amountUsd <= 0) {
      continue;
    }

    const actionType = inferActionType(segment);
    const detectedEmail = extractEmail(segment);
    const payee = extractPayee(segment, detectedEmail);
    const slug = payee.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'payee';
    const email = detectedEmail ?? `${slug}@sandbox.example.com`;
    const { category, costCenter } = inferCategory(segment, actionType);
    const referenceId = extractReferenceId(segment, actionType, i);

    let confidence = 0.72;
    if (detectedEmail) confidence += 0.14;
    if (segment.includes('$') || /usd/i.test(segment)) confidence += 0.08;
    if (/(?:from|payee|vendor|inv-|po-|ord-)/i.test(segment)) confidence += 0.05;

    candidates.push({
      referenceId,
      payee,
      email,
      actionType,
      category,
      costCenter,
      amountUsd,
      sourceExcerpt: segment.slice(0, 260),
      confidence: Math.min(0.99, Math.round(confidence * 100) / 100),
      extractionNotes: detectedEmail
        ? `Classified as ${actionType} with verified email & currency match.`
        : `Classified as ${actionType}; synthesized sandbox email from entity name.`,
    });
  }

  return candidates;
}

export function buildPayPalToolCallPlan(item: LedgerItem): PayPalToolCallPlan {
  const amountStr = item.amountUsd.toFixed(2);

  switch (item.actionType) {
    case 'INVOICE':
      return {
        toolName: 'create_invoice',
        sdkLayer: '@paypal/agent-toolkit/ai-sdk',
        httpMethod: 'POST',
        endpoint: '/v2/invoicing/invoices',
        rationale:
          'Uses PayPal Agent Toolkit create_invoice to draft a tracked B2B/contractor invoice in PayPal Sandbox.',
        payload: {
          currency_code: item.currency,
          invoice_number: item.referenceId,
          note: item.notes || `AI Ledger Ingest (${item.category})`,
          primary_recipients: [
            {
              billing_info: {
                email_address: item.email,
                name: { given_name: item.payee },
              },
            },
          ],
          items: [
            {
              name: `${item.category} Deliverable (${item.costCenter})`,
              quantity: '1',
              unit_amount: { currency_code: item.currency, value: amountStr },
            },
          ],
        },
      };

    case 'ORDER':
      return {
        toolName: 'create_order',
        sdkLayer: '@paypal/agent-toolkit/ai-sdk',
        httpMethod: 'POST',
        endpoint: '/v2/checkout/orders',
        rationale:
          'Uses PayPal Agent Toolkit create_order to create a Checkout v2 order intent ready for payer approval.',
        payload: {
          currencyCode: item.currency,
          items: [
            {
              name: `${item.category} (${item.referenceId})`,
              description: `${item.payee} - ${item.costCenter}`,
              quantity: 1,
              itemCost: item.amountUsd,
              itemTotal: item.amountUsd,
            },
          ],
          notes: item.notes || `Created via PayFlow Copilot for ${item.referenceId}`,
          returnUrl: 'https://example.com/paypal/return',
          cancelUrl: 'https://example.com/paypal/cancel',
        },
      };

    case 'DISPUTE': {
      // @paypal/agent-toolkit v1.11.0 validates accept_dispute_claim.note against /^[A-Za-z0-9_-]{1,255}$/.
      const rawNote = item.notes || 'Auto_triaged_claim_via_PayFlow_Copilot';
      const toolkitSafeNote = rawNote.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 200) || 'Auto_triaged';
      return {
        toolName: 'accept_dispute_claim',
        sdkLayer: '@paypal/agent-toolkit/ai-sdk',
        httpMethod: 'POST',
        endpoint: `/v1/customer/disputes/${item.referenceId}/accept-claim`,
        rationale:
          'Uses PayPal Agent Toolkit Disputes workflow (get_dispute -> accept_dispute_claim) when claim is validated under policy.',
        payload: {
          dispute_id: item.referenceId,
          note: toolkitSafeNote,
        },
      };
    }

    case 'REFUND':
      return {
        toolName: 'create_refund',
        sdkLayer: '@paypal/agent-toolkit/ai-sdk',
        httpMethod: 'POST',
        endpoint: `/v2/payments/captures/${item.referenceId}/refund`,
        rationale:
          'Uses PayPal Agent Toolkit create_refund to reimburse verified capture back to buyer funding source.',
        payload: {
          capture_id: item.referenceId,
          amount: {
            currency_code: item.currency,
            value: amountStr,
          },
          note_to_payer: item.notes || `Credit issued for ${item.referenceId}`,
        },
      };

    case 'PAYOUT':
    default:
      return {
        toolName: 'create_batch_payout',
        sdkLayer: 'PayPal REST Payouts v1',
        httpMethod: 'POST',
        endpoint: '/v1/payments/payouts',
        rationale:
          'Dispatches verified contractor disbursement via PayPal Batch Payouts v1 after passing duplicate & spend-cap guardrails.',
        payload: {
          sender_batch_header: {
            sender_batch_id: `PAYFLOW-${item.referenceId}-${Date.now().toString().slice(-4)}`,
            email_subject: `Payment from PayFlow Treasury (${item.referenceId})`,
          },
          items: [
            {
              recipient_type: 'EMAIL',
              receiver: item.email,
              amount: {
                value: amountStr,
                currency: item.currency,
              },
              note: item.notes || `${item.category} (${item.costCenter})`,
              sender_item_id: item.id,
            },
          ],
        },
      };
  }
}
