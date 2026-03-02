import { tool } from '@langchain/core/tools';
import type { z } from 'zod';

// Type for the GhostfolioClient (loose coupling — actual implementation imported at runtime)
export interface IGhostfolioClient {
  get<T>(
    path: string,
    params?: Record<string, string | boolean | undefined>
  ): Promise<T>;
}

interface CreateToolOptions<T extends z.ZodType> {
  name: string;
  description: string;
  schema: T;
  handler: (
    input: z.output<T>,
    client: IGhostfolioClient
  ) => Promise<[string, unknown]>;
}

export function createGhostfolioTool<T extends z.ZodType>(
  client: IGhostfolioClient,
  options: CreateToolOptions<T>
) {
  return tool(
    async (input: z.output<T>) => {
      try {
        return await options.handler(input, client);
      } catch (error) {
        if (error instanceof Error) {
          return [`Error calling ${options.name}: ${error.message}`, null];
        }

        return [`Error calling ${options.name}: Unknown error`, null];
      }
    },
    {
      name: options.name,
      description: options.description,
      schema: options.schema,
      responseFormat: 'content_and_artifact'
    }
  );
}
