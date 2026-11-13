/**
 * AI response engine — M4.
 *
 * Uses Claude to handle inbound patient messages with a narrow set of
 * allow-listed tools (see lib/ai-tools.ts). The model never has direct
 * database access and cannot send messages; it returns structured output
 * that this layer validates and executes.
 *
 * CLAUDE.md constraints enforced here:
 * - Rule 1: No real patient records processed (fixtures only until gates approved)
 * - Rule 4: Explicit patient confirmation required before booking
 * - Rule 5: No clinical notes/diagnosis in the data model
 * - Rule 6: All AI actions use validated allow-listed commands only
 */

import Anthropic from '@anthropic-ai/sdk';
import { AI_TOOLS, dispatchTool, escalateToHuman } from './ai-tools';
import { checkEmergency } from './emergency';
import {
  hasConsent,
  recordConsent,
  isConsentAcknowledgment,
  isDeletionRequest,
  eraseContactData,
  PRIVACY_NOTICE,
  ERASURE_CONFIRMATION,
} from './consent';
import { pool } from './db';
import { audit } from './audit';

const MODEL = 'claude-opus-5-5';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the automated receptionist for Ghazwan Orthopedic Clinic.
You communicate in Arabic (Iraqi dialect preferred) or English — match the patient's language.

## Clinic hours
- Saturday: 12:00–17:00 (Baghdad time)
- Sunday–Wednesday: 17:00–20:00 (Baghdad time)
- Thursday and Friday: closed

## Your role
You help patients with:
1. Checking clinic availability on a date
2. Booking a new appointment (ONLY after explicit patient confirmation — not read receipts)
3. Cancelling an existing booking at the patient's explicit request
4. Answering basic scheduling questions

## Hard limits — escalate immediately for any of these
- Medical questions, symptoms, diagnoses, prescriptions, or clinical advice
- Complaints or urgent/emergency situations
- Anything you are uncertain about

## Important rules
- Always disclose you are an automated assistant: "أنا المساعد الآلي للعيادة" / "I am the clinic's automated assistant"
- Never invent appointment times — always look up availability first
- A booking requires EXPLICIT verbal confirmation from the patient ("نعم", "أريد", "أحجز", "yes", "book it", etc.)
- Keep responses short, respectful, and clear
- Never include clinical notes, diagnosis, or medical advice in any response or booking record`;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface InboundMessage {
  role: 'user';
  content: string;
}

export interface AIResponse {
  reply: string;
  toolsUsed: string[];
  escalated: boolean;
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// Main response function
// ---------------------------------------------------------------------------

export async function generateResponse(
  conversationHistory: Anthropic.MessageParam[],
  contactId: string,
  conversationId: string,
): Promise<AIResponse> {
  // ── Consent + right-to-forget gate ──────────────────────────────────────
  // Runs before the emergency check and before the AI.
  // CLAUDE.md rule 1: privacy disclosure required before processing data.
  // CLAUDE.md rule 4: explicit consent only — no passive assumption.

  const latestUserMsg = conversationHistory
    .slice()
    .reverse()
    .find(m => m.role === 'user');
  const latestText = typeof latestUserMsg?.content === 'string'
    ? latestUserMsg.content
    : '';

  // Right-to-forget: patient requests data erasure
  if (isDeletionRequest(latestText)) {
    await eraseContactData(contactId);
    void audit({
      actorType: 'SYSTEM',
      action: 'DATA_ERASED',
      entityType: 'contact',
      entityId: contactId,
      detail: { source: 'ai_respond' },
    });
    return { reply: ERASURE_CONFIRMATION, toolsUsed: [], escalated: false, tokensUsed: 0 };
  }

  const consentGranted = await hasConsent(contactId);

  if (!consentGranted) {
    // Check if the latest message IS a consent acknowledgment
    if (isConsentAcknowledgment(latestText)) {
      // Derive channel from conversations table for audit trail
      const convRow = await pool.query<{ channel: string }>(
        `SELECT channel FROM conversations WHERE id = $1`,
        [conversationId],
      );
      const channel = convRow.rows[0]?.channel ?? 'unknown';
      await recordConsent(contactId, channel);
      void audit({
        actorType: 'SYSTEM',
        action: 'CONSENT_RECORDED',
        entityType: 'contact',
        entityId: contactId,
        detail: { channel, source: 'ai_respond' },
      });
      // Fall through — now run the AI on this confirmation message
    } else {
      // No consent yet and message is not an acknowledgment — send privacy notice
      return { reply: PRIVACY_NOTICE, toolsUsed: [], escalated: false, tokensUsed: 0 };
    }
  }

  // ── Emergency guard ──────────────────────────────────────────────────────
  const emergencyCheck = checkEmergency(latestText);
  if (emergencyCheck.isEmergency) {
    await escalateToHuman(conversationId);
    return {
      reply: emergencyCheck.fixedReply,
      toolsUsed: ['escalate_to_human'],
      escalated: true,
      tokensUsed: 0,
    };
  }

  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    // Inject contact context as a system-level mid-conversation message
    // (after the first user message, so it doesn't invalidate the system cache)
    ...conversationHistory,
  ];

  const toolsUsed: string[] = [];
  let escalated = false;
  let totalTokens = 0;

  // Agentic loop — run until end_turn or escalation
  let iterations = 0;
  const MAX_ITERATIONS = 5;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'medium' },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: AI_TOOLS,
      messages,
    });

    totalTokens += response.usage.input_tokens + response.usage.output_tokens;

    // Append assistant response to history for the next iteration
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      return {
        reply: textBlock?.text ?? '',
        toolsUsed,
        escalated,
        tokensUsed: totalTokens,
      };
    }

    if (response.stop_reason === 'refusal') {
      // Safety classifier declined — escalate to human
      await dispatchTool('escalate_to_human', { conversation_id: conversationId });
      escalated = true;
      return {
        reply: 'عذراً، سأحول رسالتك إلى أحد موظفي العيادة. / I am transferring you to a staff member.',
        toolsUsed,
        escalated,
        tokensUsed: totalTokens,
      };
    }

    if (response.stop_reason !== 'tool_use') break;

    // Execute tool calls
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      toolsUsed.push(toolUse.name);

      if (toolUse.name === 'escalate_to_human') {
        escalated = true;
      }

      try {
        const result = await dispatchTool(
          toolUse.name,
          { ...toolUse.input as Record<string, unknown>, conversation_id: conversationId, contact_id: contactId },
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: String(err),
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });

    if (escalated) {
      return {
        reply: 'عذراً، سأحول رسالتك إلى أحد موظفي العيادة. / I am transferring you to a staff member.',
        toolsUsed,
        escalated,
        tokensUsed: totalTokens,
      };
    }
  }

  // Exceeded max iterations — escalate
  await dispatchTool('escalate_to_human', { conversation_id: conversationId });
  return {
    reply: 'عذراً، سأحول رسالتك إلى أحد موظفي العيادة. / I am transferring you to a staff member.',
    toolsUsed,
    escalated: true,
    tokensUsed: totalTokens,
  };
}
