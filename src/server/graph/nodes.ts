import {
  AIMessage,
  AIMessageChunk,
  ToolMessage
} from '@langchain/core/messages';

import { estimateCost, type TokenUsage } from '../agent';
import { scoreConfidence } from '../verification/confidence-scoring';
import {
  SAFE_FALLBACK_RESPONSE,
  checkDomainConstraints
} from '../verification/domain-constraints';
import { factCheck } from '../verification/fact-check';
import { validateOutput } from '../verification/output-validation';
import { ContentBlockSchema, blocksToText } from './content-blocks';
import type {
  AgentState,
  AgentStateUpdate,
  ToolCallRecord,
  VerificationState
} from './state';

/** Check if a message is an AI message (AIMessage or AIMessageChunk). */
function isAIMessage(msg: unknown): msg is AIMessage | AIMessageChunk {
  return msg instanceof AIMessage || msg instanceof AIMessageChunk;
}

// ---------------------------------------------------------------------------
// Agent node — invokes the LLM with current messages
// ---------------------------------------------------------------------------

export function createAgentNode(llm: Runnable, model: string) {
  return async (state: AgentState): Promise<Partial<AgentStateUpdate>> => {
    const response = await llm.invoke(state.messages);

    // Accumulate token usage
    const usage = (response as AIMessage).usage_metadata;
    const prev = state.tokenUsage ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0
    };
    const inputTokens = prev.inputTokens + (usage?.input_tokens ?? 0);
    const outputTokens = prev.outputTokens + (usage?.output_tokens ?? 0);
    const totalTokens =
      (prev.totalTokens || 0) + (usage?.total_tokens ?? 0) ||
      inputTokens + outputTokens;

    const tokenUsage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost: estimateCost(model, inputTokens, outputTokens)
    };

    return {
      messages: [response],
      tokenUsage,
      iterationCount: state.iterationCount + 1
    };
  };
}

// ---------------------------------------------------------------------------
// Tool node — executes tool calls from the last AIMessage in parallel via
// Promise.all, tracks artifacts. Each tool call runs concurrently, cutting
// wall-clock time to the slowest single call.
// ---------------------------------------------------------------------------

export function createToolNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolsByName: Record<string, any>
) {
  return async (state: AgentState): Promise<Partial<AgentStateUpdate>> => {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!isAIMessage(lastMessage) || !lastMessage.tool_calls?.length) {
      return {};
    }

    const results = await Promise.all(
      lastMessage.tool_calls.map(async (tc) => {
        const toolFn = toolsByName[tc.name];

        if (!toolFn) {
          return {
            message: new ToolMessage({
              content: `Error: unknown tool "${tc.name}"`,
              tool_call_id: tc.id!
            }),
            record: { name: tc.name, success: false } as ToolCallRecord
          };
        }

        try {
          const toolMessage = await toolFn.invoke({
            name: tc.name,
            args: tc.args,
            id: tc.id!,
            type: 'tool_call' as const
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const artifact =
            toolMessage instanceof ToolMessage
              ? (toolMessage as any).artifact
              : undefined;

          const msg =
            toolMessage instanceof ToolMessage
              ? toolMessage
              : new ToolMessage({
                  content:
                    typeof toolMessage === 'string'
                      ? toolMessage
                      : String(toolMessage),
                  tool_call_id: tc.id!
                });

          return {
            message: msg,
            record: {
              name: tc.name,
              success: true,
              data: artifact ?? undefined
            } as ToolCallRecord
          };
        } catch (error) {
          return {
            message: new ToolMessage({
              content:
                error instanceof Error
                  ? `Error: ${error.message}`
                  : 'Error: unknown error',
              tool_call_id: tc.id!
            }),
            record: { name: tc.name, success: false } as ToolCallRecord
          };
        }
      })
    );

    return {
      messages: results.map((r) => r.message),
      toolCalls: results.map((r) => r.record)
    };
  };
}

// ---------------------------------------------------------------------------
// Verification node — runs the 5-check verification pipeline
// ---------------------------------------------------------------------------

export function createVerificationNode() {
  return async (state: AgentState): Promise<Partial<AgentStateUpdate>> => {
    // Use contentBlocks serialization as the response text for verification
    let responseText = state.contentBlocks
      ? blocksToText(state.contentBlocks)
      : state.responseText;

    if (!responseText || responseText.trim().length === 0) {
      responseText = 'I was unable to generate a response.';
    }

    const domainCheck = checkDomainConstraints(responseText);

    if (domainCheck.modifiedResponse) {
      responseText = domainCheck.modifiedResponse;
    }

    // If tools were called, it's financial data — ensure disclaimer is present
    const toolsWereCalled = (state.toolCalls?.length ?? 0) > 0;
    if (
      toolsWereCalled &&
      !responseText.toLowerCase().includes('informational purposes only')
    ) {
      responseText = `${responseText}\n\n*This analysis is for informational purposes only and does not constitute financial advice.*`;
    }

    // Build updated content blocks with disclaimer
    let updatedBlocks = state.contentBlocks ? [...state.contentBlocks] : [];
    if (toolsWereCalled && updatedBlocks.length > 0) {
      updatedBlocks.push(
        ContentBlockSchema.parse({
          type: 'text',
          style: 'caption',
          value:
            'This analysis is for informational purposes only and does not constitute financial advice.'
        })
      );
    }

    const outputCheck = validateOutput(responseText);
    const confidence = scoreConfidence(responseText, state.toolCalls);
    const {
      hallucination: hallucinationCheck,
      groundedness: groundednessCheck
    } = await factCheck(
      responseText,
      state.toolCalls,
      state.contentBlocks ?? []
    );

    const overallPassed = domainCheck.passed && outputCheck.passed;

    // Replace offending responses with safe fallback
    if (!overallPassed) {
      responseText = SAFE_FALLBACK_RESPONSE;
    }

    const verification: VerificationState = {
      passed: overallPassed,
      violations: domainCheck.violations,
      outputValidation: {
        passed: outputCheck.passed,
        issues: outputCheck.issues
      },
      confidence,
      hallucination: hallucinationCheck,
      groundedness: groundednessCheck
    };

    return {
      messages: [
        new AIMessage({
          content: responseText,
          additional_kwargs: {
            ...(updatedBlocks.length > 0
              ? { contentBlocks: updatedBlocks }
              : {})
          }
        })
      ],
      responseText,
      verification,
      contentBlocks: updatedBlocks.length > 0 ? updatedBlocks : undefined
    };
  };
}

// ---------------------------------------------------------------------------
// Routing function — decides whether to call tools or move to verification
// ---------------------------------------------------------------------------

export function shouldContinue(
  state: AgentState,
  maxIterations: number
): 'tools' | 'verify' {
  const lastMessage = state.messages[state.messages.length - 1];

  if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
    // Always execute pending tool calls — even at maxIterations.
    // This prevents sending an AIMessage with tool_calls to verify
    // (which would have empty content). Hard ceiling prevents infinite loops.
    if (state.iterationCount < maxIterations + 2) {
      return 'tools';
    }
  }

  return 'verify';
}
