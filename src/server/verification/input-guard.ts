export interface InputGuardResult {
  blocked: boolean;
  reason?: string;
}

const ROLE_REASSIGNMENT_PATTERNS = [
  /\byou are now\b/i,
  /\bact as a\b/i,
  /\bpretend to be\b/i,
  /\bfrom now on you are\b/i,
  /\byou'?re now a\b/i,
  /\bplay the role of\b/i,
  /\bbehave as\b/i,
  /\bswitch to .+ mode\b/i
];

const INSTRUCTION_OVERRIDE_PATTERNS = [
  /\bignore (all )?(previous|prior|above|your) (instructions|rules|constraints|guidelines)\b/i,
  /\bforget (all )?(your|the|previous) (rules|instructions|constraints)\b/i,
  /\bdisregard (all )?(your|the|previous)\b/i,
  /\boverride (your|the) (instructions|rules|system prompt)\b/i,
  /\bdo not follow (your|the) (rules|instructions|guidelines)\b/i
];

const PROMPT_EXTRACTION_PATTERNS = [
  /\bshow (me )?(your )?system prompt\b/i,
  /\bwhat are your instructions\b/i,
  /\brepeat (your|the) (system )?(prompt|instructions)\b/i,
  /\bprint (your|the) (system )?(prompt|instructions)\b/i,
  /\bwhat were you told\b/i,
  /\bwhat is your (initial|original) prompt\b/i
];

const JAILBREAK_PATTERNS = [
  /\bDAN\b/,
  /\bjailbreak\b/i,
  /\bdo anything now\b/i,
  /\bdeveloper mode\b/i,
  /\bunlocked mode\b/i,
  /\bno restrictions\b/i,
  /\bbypass (your |the )?(safety|content|filter|rules)\b/i
];

const ALL_PATTERNS: { patterns: RegExp[]; reason: string }[] = [
  {
    patterns: ROLE_REASSIGNMENT_PATTERNS,
    reason: 'Role reassignment attempt detected'
  },
  {
    patterns: INSTRUCTION_OVERRIDE_PATTERNS,
    reason: 'Instruction override attempt detected'
  },
  {
    patterns: PROMPT_EXTRACTION_PATTERNS,
    reason: 'Prompt extraction attempt detected'
  },
  { patterns: JAILBREAK_PATTERNS, reason: 'Jailbreak attempt detected' }
];

/**
 * Fast regex-based pre-screener that catches common prompt injection patterns
 * before the message reaches the LLM. This saves tokens and provides
 * immediate rejection for obvious attacks.
 */
export function checkInputForInjection(message: string): InputGuardResult {
  for (const { patterns, reason } of ALL_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return { blocked: true, reason };
      }
    }
  }

  return { blocked: false };
}
