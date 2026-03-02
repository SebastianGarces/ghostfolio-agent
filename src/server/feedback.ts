import { Client } from 'langsmith';

let langsmithClient: Client | null = null;

function getClient(): Client | null {
  if (process.env.LANGCHAIN_TRACING_V2 !== 'true') {
    return null;
  }
  if (!langsmithClient) {
    langsmithClient = new Client();
  }
  return langsmithClient;
}

export interface FeedbackRequest {
  runId: string;
  score: number;
  comment?: string;
}

export interface FeedbackResult {
  success: boolean;
  feedbackId?: string;
  error?: string;
}

export async function submitFeedback(
  request: FeedbackRequest
): Promise<FeedbackResult> {
  const client = getClient();
  if (!client) {
    return {
      success: false,
      error: 'LangSmith tracing is not enabled'
    };
  }

  try {
    const feedback = await client.createFeedback(request.runId, 'user-rating', {
      score: request.score,
      comment: request.comment,
      feedbackSourceType: 'app'
    });
    return {
      success: true,
      feedbackId: feedback.id
    };
  } catch (error) {
    console.error('[feedback] Failed to submit feedback:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
