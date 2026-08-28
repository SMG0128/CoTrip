import {
  AICommentAnalysis,
  AICommentIntent,
  ConstraintDraft,
  ConstraintDraftPriority,
  ConstraintDraftScope,
  ConstraintDraftType,
} from '../types/ai-comment';
import { AICommentServiceError } from './ai-comment-service';

const INTENTS: AICommentIntent[] = ['constraint', 'preference', 'chat', 'unclear'];
const TYPES: ConstraintDraftType[] = ['AVAILABILITY', 'LOCATION', 'BUDGET', 'PREFERENCE'];
const SCOPES: ConstraintDraftScope[] = ['TRIP', 'SPORT', 'DINING', 'TRANSPORT'];
const PRIORITIES: ConstraintDraftPriority[] = ['HARD', 'SOFT'];

function invalid(): never {
  throw new AICommentServiceError('AI_INVALID_RESPONSE', 'AI 返回了无效的结构化评论分析');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validateValue(type: ConstraintDraftType, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalid();

  if (type === 'AVAILABILITY') {
    if (!hasOnlyKeys(value, ['availableAfter', 'availableUntil'])) invalid();
    const after = value.availableAfter;
    const until = value.availableUntil;
    if (typeof after !== 'string' && typeof until !== 'string') invalid();
    for (const candidate of [after, until]) {
      if (candidate !== undefined && (typeof candidate !== 'string' || !Number.isFinite(Date.parse(candidate)))) {
        invalid();
      }
    }
    return value;
  }

  if (type === 'LOCATION') {
    if (!hasOnlyKeys(value, ['district', 'city', 'locationId'])) invalid();
    const keys = ['district', 'city', 'locationId'] as const;
    if (!keys.some((key) => typeof value[key] === 'string' && (value[key] as string).trim())) invalid();
    if (keys.some((key) => value[key] !== undefined && typeof value[key] !== 'string')) invalid();
    return value;
  }

  if (type === 'BUDGET') {
    if (!hasOnlyKeys(value, ['max', 'min', 'currency', 'unit', 'preference'])) invalid();
    const max = value.max;
    const min = value.min;
    const preference = value.preference;
    if (typeof max !== 'number' && typeof min !== 'number' && preference === undefined) invalid();
    if (max !== undefined && (typeof max !== 'number' || !Number.isFinite(max) || max < 0)) invalid();
    if (min !== undefined && (typeof min !== 'number' || !Number.isFinite(min) || min < 0)) invalid();
    if (typeof min === 'number' && typeof max === 'number' && min > max) invalid();
    if (value.currency !== undefined && value.currency !== 'CNY') invalid();
    if (value.unit !== undefined && !['TOTAL', 'PER_PERSON', 'PER_HOUR'].includes(String(value.unit))) invalid();
    if (preference !== undefined && !['LOW_COST', 'HIGH_QUALITY'].includes(String(preference))) invalid();
    return value;
  }

  if (!hasOnlyKeys(value, ['keyword', 'note'])) invalid();
  const keyword = value.keyword;
  const note = value.note;
  if (typeof keyword !== 'string' && typeof note !== 'string') invalid();
  if (keyword !== undefined && typeof keyword !== 'string') invalid();
  if (note !== undefined && typeof note !== 'string') invalid();
  return value;
}

function validateConstraint(value: unknown): ConstraintDraft {
  if (!isRecord(value)) invalid();
  if (!hasOnlyKeys(value, ['type', 'scope', 'priority', 'value'])) invalid();
  const type = value.type;
  const scope = value.scope;
  const priority = value.priority;
  if (typeof type !== 'string' || !TYPES.includes(type as ConstraintDraftType)) invalid();
  if (typeof scope !== 'string' || !SCOPES.includes(scope as ConstraintDraftScope)) invalid();
  if (typeof priority !== 'string' || !PRIORITIES.includes(priority as ConstraintDraftPriority)) invalid();
  return {
    type: type as ConstraintDraftType,
    scope: scope as ConstraintDraftScope,
    priority: priority as ConstraintDraftPriority,
    value: validateValue(type as ConstraintDraftType, value.value),
  };
}

/** LLM JSON → schema validation → domain validation → 可持久化分析。 */
export function validateAICommentAnalysis(value: unknown): AICommentAnalysis {
  if (!isRecord(value)) invalid();
  if (!hasOnlyKeys(value, ['intent', 'constraints', 'confidence', 'requiresConfirmation', 'summary'])) invalid();
  const intent = value.intent;
  if (typeof intent !== 'string' || !INTENTS.includes(intent as AICommentIntent)) invalid();
  if (!Array.isArray(value.constraints)) invalid();
  if (value.constraints.length > 8) invalid();
  const confidence = value.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) invalid();
  if (typeof value.requiresConfirmation !== 'boolean') invalid();
  if (value.summary !== undefined && typeof value.summary !== 'string') invalid();

  const constraints = value.constraints.map(validateConstraint);
  if ((intent === 'chat' || intent === 'unclear') && constraints.length > 0) invalid();
  if ((intent === 'constraint' || intent === 'preference') && constraints.length === 0) invalid();

  return {
    intent: intent as AICommentIntent,
    constraints,
    confidence,
    requiresConfirmation: value.requiresConfirmation,
    ...(typeof value.summary === 'string' ? { summary: value.summary.slice(0, 300) } : {}),
  };
}
