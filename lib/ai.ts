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
import { AI_TOOLS, dispatchTool } from './ai-tools';

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
