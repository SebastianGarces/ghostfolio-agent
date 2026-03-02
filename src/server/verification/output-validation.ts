export interface OutputValidationResult {
  passed: boolean;
  issues: {
    rule: string;
    severity: 'error' | 'warning';
    description: string;
  }[];
}

const RAW_JSON_PATTERN = /\{\s*"[a-zA-Z_]+"\s*:/;
// Match "null" or "undefined" only in programmatic contexts (code/JSON leaks),
// not natural language usage like "null and void" or discussion of null values
const UNDEFINED_NULL_PATTERN =
  /(?::\s*(?:undefined|null)\b|\b(?:undefined|null)\s*[,}\]])/;
const STACK_TRACE_PATTERN =
  /(?:^|\n)\s*(?:Error:|at\s+Object\.|at\s+Module\.|at\s+async\s+)/;

const MAX_RESPONSE_LENGTH = 5000;

/**
 * Validates response structure and format quality.
 * Checks for raw JSON dumps, undefined/null leaks, reasonable length, and stack traces.
 */
export function validateOutput(response: string): OutputValidationResult {
  const issues: OutputValidationResult['issues'] = [];

  // Rule 1: No raw JSON objects in response
  if (RAW_JSON_PATTERN.test(response)) {
    issues.push({
      rule: 'no-raw-json',
      severity: 'warning',
      description:
        'Response contains raw JSON object. Agent should format data for readability.'
    });
  }

  // Rule 2: No undefined/null literal leaks
  if (UNDEFINED_NULL_PATTERN.test(response)) {
    issues.push({
      rule: 'no-undefined-null',
      severity: 'warning',
      description:
        'Response contains literal "undefined" or "null" string which may indicate a formatting bug.'
    });
  }

  // Rule 3: Reasonable length
  if (response.trim().length === 0) {
    issues.push({
      rule: 'non-empty-response',
      severity: 'error',
      description: 'Response is empty.'
    });
  } else if (response.length > MAX_RESPONSE_LENGTH) {
    issues.push({
      rule: 'reasonable-length',
      severity: 'warning',
      description: `Response is ${response.length} characters, exceeding ${MAX_RESPONSE_LENGTH} character guideline.`
    });
  }

  // Rule 4: No error stack traces
  if (STACK_TRACE_PATTERN.test(response)) {
    issues.push({
      rule: 'no-stack-traces',
      severity: 'error',
      description:
        'Response contains error stack trace that should not be exposed to users.'
    });
  }

  const passed = issues.every((i) => i.severity !== 'error');

  return { passed, issues };
}
