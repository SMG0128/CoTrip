// AI Trip Pipeline V2 Gateway contract.
//
// CoTrip Server remains the final trust boundary. This module mirrors the
// Server's public request/envelope invariants so malformed model output is
// rejected at the Gateway as well. It never repairs an invalid success result.

const SCHEMA_VERSION = '1.0';
const REQUEST_TYPES = [
  'PREPROCESS',
  'COMMENT_EVALUATION',
  'INITIAL_GENERATION',
  'TRIP_UPDATE',
];
const EVENT_TYPES = ['SPORT', 'DINING', 'TRANSPORT', 'ENTERTAINMENT', 'OTHER'];
const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'requestType',
  'status',
  'analysis',
  'decision',
  'trip',
  'ui',
  'meta',
];
const UI_KEYS = ['changedEventIds', 'highlightEventIds', 'removedEventIds', 'message'];
const UI_ID_FIELDS = ['changedEventIds', 'highlightEventIds', 'removedEventIds'];
const TRIP_SIGNAL_KEYS = [
  'places',
  'timeExpressions',
  'durationExpressions',
  'sequenceWords',
  'actionWords',
];
const FORBIDDEN_STYLE_KEYS = [
  'color',
  'background',
  'backgroundColor',
  'font',
  'fontSize',
  'fontWeight',
  'border',
  'borderRadius',
  'shadow',
  'padding',
  'margin',
  'className',
  'class',
  'style',
  'animation',
  'icon',
  'iconUrl',
  'image',
  'imageUrl',
  'theme',
];
const FORBIDDEN_REAL_WORLD_KEYS = ['location', 'price', 'restaurant', 'rating', 'route'];
const MAX_UI_IDS = 50;
const MAX_ID_LENGTH = 64;
const MAX_MESSAGE_LENGTH = 200;
const MAX_TRIP_ITEMS = 50;
const MAX_SUMMARY_LENGTH = 500;
const MAX_TITLE_LENGTH = 100;
const MAX_INITIAL_BRIEF_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 10000;
const ISO_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MARKUP_PATTERN = /[<>]|&[a-zA-Z#][a-zA-Z0-9]*;/;

function valid(value) {
  return value === undefined ? { ok: true } : { ok: true, value };
}

function invalid(failurePath, failureReasonCode) {
  return { ok: false, failurePath, failureReasonCode };
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateExactKeys(value, allowed, required, path) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) return invalid(`${path}.${unexpected}`, 'UNEXPECTED_KEY');
  const missing = required.find((key) => !(key in value));
  return missing === undefined ? valid() : invalid(`${path}.${missing}`, 'REQUIRED_FIELD');
}

function validateTripSignals(value, path) {
  if (!isRecord(value)) return invalid(path, 'TRIP_SIGNALS_OBJECT_REQUIRED');
  const shape = validateExactKeys(value, TRIP_SIGNAL_KEYS, TRIP_SIGNAL_KEYS, path);
  if (!shape.ok) return shape;
  for (const key of TRIP_SIGNAL_KEYS) {
    if (!Array.isArray(value[key])) return invalid(`${path}.${key}`, 'EXPECTED_STRING_ARRAY');
    for (let index = 0; index < value[key].length; index += 1) {
      if (typeof value[key][index] !== 'string') {
        return invalid(`${path}.${key}[${index}]`, 'EXPECTED_STRING');
      }
    }
  }
  return valid();
}

function findForbiddenStyleKey(value, path = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenStyleKey(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_STYLE_KEYS.includes(key)) return `${path}.${key}`;
    const found = findForbiddenStyleKey(nested, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string'
    && value.trim().length > 0
    && (maxLength === undefined || value.length <= maxLength);
}

function isIsoWithTimezone(value) {
  return typeof value === 'string'
    && ISO_WITH_TIMEZONE.test(value)
    && Number.isFinite(Date.parse(value));
}

/** Pipeline endpoints require pure JSON. Markdown fences are intentionally rejected. */
function parseStrictJsonContent(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('EMPTY_AI_TEXT');
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('```') || trimmed.endsWith('```')) {
    throw new Error('MARKDOWN_FENCE_FORBIDDEN');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error('INVALID_AI_JSON');
  }
}

function validateTripInput(value, path) {
  if (!isRecord(value)) return invalid(path, 'TRIP_INPUT_OBJECT_REQUIRED');
  const keys = ['title', 'initialBrief', 'areaConstraint', 'timeRange'];
  const shape = validateExactKeys(value, keys, ['title', 'initialBrief'], path);
  if (!shape.ok) return shape;
  if (!isNonEmptyString(value.title, MAX_TITLE_LENGTH)) {
    return invalid(`${path}.title`, 'TITLE_INVALID');
  }
  if (typeof value.initialBrief !== 'string' || value.initialBrief.length > MAX_INITIAL_BRIEF_LENGTH) {
    return invalid(`${path}.initialBrief`, 'INITIAL_BRIEF_INVALID');
  }
  return valid();
}

function validateComment(value, path) {
  if (!isRecord(value)) return invalid(path, 'COMMENT_OBJECT_REQUIRED');
  const shape = validateExactKeys(value, ['id', 'rawText', 'createdAt'], ['id', 'rawText', 'createdAt'], path);
  if (!shape.ok) return shape;
  if (!isNonEmptyString(value.id, MAX_ID_LENGTH)) return invalid(`${path}.id`, 'COMMENT_ID_INVALID');
  if (!isNonEmptyString(value.rawText, MAX_COMMENT_LENGTH)) {
    return invalid(`${path}.rawText`, 'COMMENT_TEXT_INVALID');
  }
  if (!isNonEmptyString(value.createdAt, 64)) return invalid(`${path}.createdAt`, 'COMMENT_TIME_INVALID');
  return valid();
}

function validateAIContext(value, path) {
  if (value === null) return valid();
  if (!isRecord(value)) return invalid(path, 'AI_CONTEXT_OBJECT_OR_NULL_REQUIRED');
  if (value.requestType !== 'PREPROCESS' || value.trip !== null) {
    return invalid(path, 'AI_CONTEXT_INVALID');
  }
  if (!isRecord(value.decision) || value.decision.canGenerateTrip !== false) {
    return invalid(`${path}.decision`, 'AI_CONTEXT_INVALID');
  }
  return valid();
}

function validateLocationRequirement(value, path, options) {
  if (value === undefined) return valid();
  if (!isRecord(value)) return invalid(path, 'LOCATION_REQUIREMENT_OBJECT_REQUIRED');
  const shape = validateExactKeys(value, ['city', 'district', 'locationId'], [], path);
  if (!shape.ok) return shape;
  for (const key of ['city', 'district', 'locationId']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      return invalid(`${path}.${key}`, 'LOCATION_REQUIREMENT_NOT_STRING');
    }
  }
  if (value.locationId !== undefined) {
    if (!options.allowLocationId) return invalid(`${path}.locationId`, 'AI_FORBIDDEN_REAL_WORLD_FACT');
    if (value.locationId !== options.previousLocationId) {
      return invalid(`${path}.locationId`, 'LOCATION_ID_NOT_PRESERVED');
    }
  }
  return valid();
}

function validateTripItem(value, index, options) {
  const path = `${options.pathPrefix}[${index}]`;
  if (!isRecord(value)) return invalid(path, 'ITEM_OBJECT_REQUIRED');
  for (const forbidden of FORBIDDEN_REAL_WORLD_KEYS) {
    if (value[forbidden] !== undefined) {
      return invalid(`${path}.${forbidden}`, 'AI_FORBIDDEN_REAL_WORLD_FACT');
    }
  }
  const keys = ['id', 'type', 'title', 'time', 'locationRequirement', 'alternatives'];
  const required = options.requireId
    ? ['id', 'type', 'title', 'time']
    : ['type', 'title', 'time'];
  const shape = validateExactKeys(value, keys, required, path);
  if (!shape.ok) return shape;

  if (value.id !== undefined) {
    if (!options.allowIds) return invalid(`${path}.id`, 'ITEM_ID_NOT_ALLOWED');
    if (!isNonEmptyString(value.id, MAX_ID_LENGTH)) return invalid(`${path}.id`, 'ITEM_ID_INVALID');
    if (options.allowedIds && !options.allowedIds.has(value.id)) {
      return invalid(`${path}.id`, 'ITEM_ID_UNKNOWN');
    }
    if (options.seenIds.has(value.id)) return invalid(`${path}.id`, 'ITEM_ID_DUPLICATED');
    options.seenIds.add(value.id);
  }
  if (!EVENT_TYPES.includes(value.type)) return invalid(`${path}.type`, 'ITEM_TYPE_INVALID');
  if (!isNonEmptyString(value.title, 500)) return invalid(`${path}.title`, 'ITEM_TITLE_REQUIRED');

  if (!isRecord(value.time)) return invalid(`${path}.time`, 'ITEM_TIME_OBJECT_REQUIRED');
  const timeShape = validateExactKeys(value.time, ['start', 'end', 'timezone'], ['start', 'timezone'], `${path}.time`);
  if (!timeShape.ok) return timeShape;
  if (!isIsoWithTimezone(value.time.start)) return invalid(`${path}.time.start`, 'ITEM_TIME_START_NOT_ISO');
  if (value.time.end !== undefined) {
    if (!isIsoWithTimezone(value.time.end)) return invalid(`${path}.time.end`, 'ITEM_TIME_END_NOT_ISO');
    if (Date.parse(value.time.end) < Date.parse(value.time.start)) {
      return invalid(`${path}.time.end`, 'ITEM_TIME_RANGE_INVERTED');
    }
  }
  if (!isNonEmptyString(value.time.timezone, 100)) {
    return invalid(`${path}.time.timezone`, 'ITEM_TIME_TIMEZONE_REQUIRED');
  }

  const previous = value.id && options.previousEventsById
    ? options.previousEventsById.get(value.id)
    : undefined;
  const location = validateLocationRequirement(value.locationRequirement, `${path}.locationRequirement`, {
    allowLocationId: options.allowLocationId,
    previousLocationId: previous && previous.locationRequirement
      ? previous.locationRequirement.locationId
      : undefined,
  });
  if (!location.ok) return location;

  if (value.alternatives !== undefined) {
    if (!Array.isArray(value.alternatives)) {
      return invalid(`${path}.alternatives`, 'ITEM_ALTERNATIVES_ARRAY_REQUIRED');
    }
    if (value.alternatives.length > 50) {
      return invalid(`${path}.alternatives`, 'ITEM_ALTERNATIVES_TOO_MANY');
    }
    for (let alternativeIndex = 0; alternativeIndex < value.alternatives.length; alternativeIndex += 1) {
      if (!isNonEmptyString(value.alternatives[alternativeIndex], 500)) {
        return invalid(`${path}.alternatives[${alternativeIndex}]`, 'ITEM_ALTERNATIVE_INVALID');
      }
    }
  }
  return valid();
}

function validateCurrentPlan(value, path) {
  if (!isRecord(value)) return invalid(path, 'CURRENT_PLAN_OBJECT_REQUIRED');
  const keys = [
    'id',
    'tripId',
    'version',
    'events',
    'summary',
    'satisfiedConstraintCount',
    'totalConstraintCount',
    'conflicts',
    'updatedAt',
  ];
  const required = keys.filter((key) => key !== 'summary');
  const shape = validateExactKeys(value, keys, required, path);
  if (!shape.ok) return shape;
  if (!isNonEmptyString(value.id, MAX_ID_LENGTH)) return invalid(`${path}.id`, 'PLAN_ID_INVALID');
  if (!isNonEmptyString(value.tripId, MAX_ID_LENGTH)) return invalid(`${path}.tripId`, 'TRIP_ID_INVALID');
  if (!Number.isInteger(value.version) || value.version < 1) return invalid(`${path}.version`, 'PLAN_VERSION_INVALID');
  if (!Array.isArray(value.events) || value.events.length === 0 || value.events.length > MAX_TRIP_ITEMS) {
    return invalid(`${path}.events`, 'PLAN_EVENTS_INVALID');
  }
  if (value.summary !== undefined && typeof value.summary !== 'string') {
    return invalid(`${path}.summary`, 'PLAN_SUMMARY_INVALID');
  }
  if (!Number.isInteger(value.satisfiedConstraintCount) || value.satisfiedConstraintCount < 0) {
    return invalid(`${path}.satisfiedConstraintCount`, 'PLAN_COUNT_INVALID');
  }
  if (!Number.isInteger(value.totalConstraintCount) || value.totalConstraintCount < 0) {
    return invalid(`${path}.totalConstraintCount`, 'PLAN_COUNT_INVALID');
  }
  if (!Array.isArray(value.conflicts) || value.conflicts.length !== 0) {
    return invalid(`${path}.conflicts`, 'PLAN_CONFLICTS_INVALID');
  }
  if (!isNonEmptyString(value.updatedAt, 64)) return invalid(`${path}.updatedAt`, 'PLAN_TIME_INVALID');

  const seenIds = new Set();
  for (let index = 0; index < value.events.length; index += 1) {
    const result = validateTripItem(value.events[index], index, {
      pathPrefix: `${path}.events`,
      allowIds: true,
      requireId: true,
      allowLocationId: true,
      allowedIds: null,
      previousEventsById: null,
      seenIds,
    });
    if (!result.ok) return result;
  }
  return valid();
}

function validateCommentEvaluationProjection(value, path) {
  if (!isRecord(value)) return invalid(path, 'COMMENT_EVALUATION_OBJECT_REQUIRED');
  // JudgeAgent 放行语义（可选，向后兼容）：
  //   shouldForward —— 是否值得交给 PlanAgent
  //   judgeStatus   —— actionable / irrelevant / insufficient / unsupported
  //   intentDomain  —— trip / non_trip / unknown
  const keys = ['commentIntent', 'relevant', 'usable', 'updateRequired', 'reason', 'shouldForward', 'judgeStatus', 'intentDomain', 'signals'];
  const required = ['commentIntent', 'relevant', 'usable', 'updateRequired', 'reason'];
  const shape = validateExactKeys(value, keys, required, path);
  if (!shape.ok) return shape;
  if (!isNonEmptyString(value.commentIntent, 120)) return invalid(`${path}.commentIntent`, 'COMMENT_INTENT_INVALID');
  for (const key of ['relevant', 'usable', 'updateRequired']) {
    if (typeof value[key] !== 'boolean') return invalid(`${path}.${key}`, 'DECISION_FLAG_NOT_BOOLEAN');
  }
  if (!isNonEmptyString(value.reason, 300)) return invalid(`${path}.reason`, 'DECISION_REASON_INVALID');
  if (value.shouldForward !== undefined && typeof value.shouldForward !== 'boolean') {
    return invalid(`${path}.shouldForward`, 'JUDGE_SHOULD_FORWARD_NOT_BOOLEAN');
  }
  for (const key of ['judgeStatus', 'intentDomain']) {
    if (value[key] !== undefined && !isNonEmptyString(value[key], 40)) {
      return invalid(`${path}.${key}`, 'JUDGE_SEMANTIC_STRING_INVALID');
    }
  }
  if (value.signals !== undefined) {
    const signals = validateTripSignals(value.signals, `${path}.signals`);
    if (!signals.ok) return signals;
  }
  return valid();
}

function validatePipelineInput(requestType, body) {
  if (!REQUEST_TYPES.includes(requestType)) return invalid('$', 'INVALID_REQUEST_TYPE');
  if (!isRecord(body)) return invalid('$', 'INVALID_INPUT');
  const propertyByType = {
    PREPROCESS: 'preprocess',
    COMMENT_EVALUATION: 'commentEvaluation',
    INITIAL_GENERATION: 'initialGeneration',
    TRIP_UPDATE: 'tripUpdate',
  };
  const property = propertyByType[requestType];
  const rootShape = validateExactKeys(body, [property], [property], '$');
  if (!rootShape.ok) return rootShape;
  const input = body[property];
  if (!isRecord(input)) return invalid(property, 'INPUT_OBJECT_REQUIRED');

  const commonKeys = ['title', 'tripInput'];
  const additionalKeys = {
    PREPROCESS: [],
    COMMENT_EVALUATION: ['aiContext', 'comment'],
    INITIAL_GENERATION: ['aiContext', 'triggeringComment'],
    TRIP_UPDATE: ['aiContext', 'currentPlan', 'triggeringComment', 'commentEvaluation', 'baseVersion'],
  }[requestType];
  const allowed = [...commonKeys, ...additionalKeys];
  const shape = validateExactKeys(input, allowed, allowed, property);
  if (!shape.ok) return shape;
  if (!isNonEmptyString(input.title, MAX_TITLE_LENGTH)) return invalid(`${property}.title`, 'TITLE_INVALID');
  const tripInput = validateTripInput(input.tripInput, `${property}.tripInput`);
  if (!tripInput.ok) return tripInput;
  if (input.tripInput.title !== input.title) return invalid(`${property}.tripInput.title`, 'TITLE_MISMATCH');

  if (requestType === 'COMMENT_EVALUATION' || requestType === 'INITIAL_GENERATION' || requestType === 'TRIP_UPDATE') {
    const context = validateAIContext(input.aiContext, `${property}.aiContext`);
    if (!context.ok) return context;
    const commentKey = requestType === 'COMMENT_EVALUATION' ? 'comment' : 'triggeringComment';
    const comment = validateComment(input[commentKey], `${property}.${commentKey}`);
    if (!comment.ok) return comment;
  }

  if (requestType === 'TRIP_UPDATE') {
    const plan = validateCurrentPlan(input.currentPlan, `${property}.currentPlan`);
    if (!plan.ok) return plan;
    if (!Number.isInteger(input.baseVersion) || input.baseVersion !== input.currentPlan.version) {
      return invalid(`${property}.baseVersion`, 'BASE_VERSION_MISMATCH');
    }
    const evaluation = validateCommentEvaluationProjection(
      input.commentEvaluation,
      `${property}.commentEvaluation`,
    );
    if (!evaluation.ok) return evaluation;
  }

  return valid(input);
}

function validateUI(value, requestType, trip, previousPlan) {
  if (!isRecord(value)) return invalid('ui', 'AI_UI_OBJECT_REQUIRED');
  const shape = validateExactKeys(value, UI_KEYS, UI_KEYS, 'ui');
  if (!shape.ok) return shape;

  const previousIds = new Set(
    previousPlan && Array.isArray(previousPlan.events)
      ? previousPlan.events.map((event) => event.id)
      : [],
  );
  const newIds = new Set(
    trip && Array.isArray(trip.items)
      ? trip.items.filter((item) => typeof item.id === 'string').map((item) => item.id)
      : [],
  );

  for (const field of UI_ID_FIELDS) {
    const ids = value[field];
    if (!Array.isArray(ids)) return invalid(`ui.${field}`, 'AI_UI_ID_ARRAY_REQUIRED');
    if (ids.length > MAX_UI_IDS) return invalid(`ui.${field}`, 'AI_UI_TOO_MANY_IDS');
    const seen = new Set();
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      if (!isNonEmptyString(id, MAX_ID_LENGTH)) return invalid(`ui.${field}[${index}]`, 'AI_UI_ID_INVALID');
      if (seen.has(id)) return invalid(`ui.${field}[${index}]`, 'AI_UI_ID_DUPLICATED');
      seen.add(id);
      if (requestType !== 'TRIP_UPDATE') {
        return invalid(`ui.${field}`, field === 'removedEventIds' ? 'AI_UI_REMOVAL_NOT_ALLOWED' : 'AI_UI_UNKNOWN_EVENT_ID');
      }
      if (field === 'removedEventIds') {
        if (!previousIds.has(id) || newIds.has(id)) return invalid(`ui.${field}`, 'AI_UI_INVALID_REMOVED_ID');
      } else if (!newIds.has(id)) {
        return invalid(`ui.${field}`, 'AI_UI_UNKNOWN_EVENT_ID');
      }
    }
  }

  if (value.message !== null) {
    if (typeof value.message !== 'string') return invalid('ui.message', 'AI_UI_MESSAGE_NOT_STRING');
    if (value.message.length > MAX_MESSAGE_LENGTH) return invalid('ui.message', 'AI_UI_MESSAGE_TOO_LONG');
    if (MARKUP_PATTERN.test(value.message)) return invalid('ui.message', 'AI_UI_MESSAGE_MARKUP_FORBIDDEN');
    if (hasControlCharacters(value.message)) return invalid('ui.message', 'AI_UI_MESSAGE_CONTROL_CHAR_FORBIDDEN');
  }
  return valid();
}

function validateTripSnapshot(value, requestType, previousPlan) {
  if (!isRecord(value)) return invalid('trip', 'TRIP_SNAPSHOT_REQUIRED');
  const shape = validateExactKeys(value, ['title', 'summary', 'items'], ['title', 'summary', 'items'], 'trip');
  if (!shape.ok) return shape;
  if (!isNonEmptyString(value.title, MAX_TITLE_LENGTH)) return invalid('trip.title', 'TRIP_TITLE_REQUIRED');
  if (!isNonEmptyString(value.summary, MAX_SUMMARY_LENGTH)) return invalid('trip.summary', 'TRIP_SUMMARY_REQUIRED');
  if (!Array.isArray(value.items)) return invalid('trip.items', 'TRIP_ITEMS_ARRAY_REQUIRED');
  if (value.items.length === 0) return invalid('trip.items', 'TRIP_ITEMS_EMPTY');
  if (value.items.length > MAX_TRIP_ITEMS) return invalid('trip.items', 'TRIP_ITEMS_TOO_MANY');

  const previousEvents = previousPlan && Array.isArray(previousPlan.events)
    ? previousPlan.events
    : [];
  const previousEventsById = new Map(previousEvents.map((event) => [event.id, event]));
  const previousIds = new Set(previousEventsById.keys());
  const seenIds = new Set();
  for (let index = 0; index < value.items.length; index += 1) {
    const result = validateTripItem(value.items[index], index, {
      pathPrefix: 'trip.items',
      allowIds: requestType === 'TRIP_UPDATE',
      requireId: false,
      allowLocationId: requestType === 'TRIP_UPDATE',
      allowedIds: requestType === 'TRIP_UPDATE' ? previousIds : null,
      previousEventsById,
      seenIds,
    });
    if (!result.ok) return result;
  }
  return valid();
}

function validatePipelineEnvelope(value, requestType, input) {
  if (!REQUEST_TYPES.includes(requestType)) return invalid('$', 'INVALID_REQUEST_TYPE');
  if (!isRecord(value)) return invalid('$', 'NOT_OBJECT');
  const stylePath = findForbiddenStyleKey(value);
  if (stylePath) return invalid(stylePath, 'AI_UI_FORBIDDEN_STYLE_FIELD');
  const shape = validateExactKeys(value, TOP_LEVEL_KEYS, TOP_LEVEL_KEYS, '$');
  if (!shape.ok) return shape;
  if (value.schemaVersion !== SCHEMA_VERSION) return invalid('schemaVersion', 'INVALID_SCHEMA_VERSION');
  if (value.requestType !== requestType) return invalid('requestType', 'INVALID_REQUEST_TYPE');
  if (value.status !== 'success') return invalid('status', 'INVALID_STATUS');
  if (!isRecord(value.meta)) return invalid('meta', 'META_OBJECT_REQUIRED');

  if (requestType === 'PREPROCESS') {
    if (!isRecord(value.analysis)) return invalid('analysis', 'ANALYSIS_OBJECT_REQUIRED');
    const analysisKeys = ['title', 'intent', 'constraints', 'activities', 'missingInformation'];
    const analysisShape = validateExactKeys(value.analysis, analysisKeys, analysisKeys, 'analysis');
    if (!analysisShape.ok) return analysisShape;
    if (!isNonEmptyString(value.analysis.title, MAX_TITLE_LENGTH)) return invalid('analysis.title', 'ANALYSIS_TITLE_REQUIRED');
    if (!isNonEmptyString(value.analysis.intent, 500)) return invalid('analysis.intent', 'ANALYSIS_INTENT_REQUIRED');
    if (!isRecord(value.analysis.constraints)) return invalid('analysis.constraints', 'ANALYSIS_CONSTRAINTS_OBJECT_REQUIRED');
    for (const field of ['activities', 'missingInformation']) {
      if (!Array.isArray(value.analysis[field])) return invalid(`analysis.${field}`, 'EXPECTED_STRING_ARRAY');
      if (value.analysis[field].length > 50) return invalid(`analysis.${field}`, 'TOO_MANY_ITEMS');
      for (let index = 0; index < value.analysis[field].length; index += 1) {
        if (!isNonEmptyString(value.analysis[field][index], 500)) {
          return invalid(`analysis.${field}[${index}]`, 'EXPECTED_STRING');
        }
      }
    }
    if (!isRecord(value.decision)) return invalid('decision', 'DECISION_OBJECT_REQUIRED');
    const decisionShape = validateExactKeys(value.decision, ['canGenerateTrip'], ['canGenerateTrip'], 'decision');
    if (!decisionShape.ok) return decisionShape;
    if (value.decision.canGenerateTrip !== false) return invalid('decision.canGenerateTrip', 'AI_FORBIDDEN_GENERATION_FLAG');
    if (value.trip !== null) return invalid('trip', 'AI_FORBIDDEN_ITINERARY');
  } else if (requestType === 'COMMENT_EVALUATION') {
    if (!isRecord(value.analysis)) return invalid('analysis', 'ANALYSIS_OBJECT_REQUIRED');
    const analysisShape = validateExactKeys(value.analysis, ['commentIntent'], ['commentIntent'], 'analysis');
    if (!analysisShape.ok) return analysisShape;
    if (!isNonEmptyString(value.analysis.commentIntent, 120)) return invalid('analysis.commentIntent', 'ANALYSIS_COMMENT_INTENT_REQUIRED');
    if (!isRecord(value.decision)) return invalid('decision', 'DECISION_OBJECT_REQUIRED');
    const decisionKeys = ['relevant', 'usable', 'updateRequired', 'reason'];
    const decisionShape = validateExactKeys(value.decision, decisionKeys, decisionKeys, 'decision');
    if (!decisionShape.ok) return decisionShape;
    for (const key of ['relevant', 'usable', 'updateRequired']) {
      if (typeof value.decision[key] !== 'boolean') return invalid(`decision.${key}`, 'DECISION_FLAG_NOT_BOOLEAN');
    }
    if (!isNonEmptyString(value.decision.reason, 300)) return invalid('decision.reason', 'DECISION_REASON_REQUIRED');
    if (value.trip !== null) return invalid('trip', 'AI_FORBIDDEN_ITINERARY');
  } else {
    if (!isRecord(value.analysis)) return invalid('analysis', 'ANALYSIS_OBJECT_REQUIRED');
    if (Object.keys(value.analysis).length !== 0) return invalid('analysis', 'UNEXPECTED_KEY');
    if (!isRecord(value.decision)) return invalid('decision', 'DECISION_OBJECT_REQUIRED');
    const decisionShape = validateExactKeys(value.decision, ['tripChanged'], ['tripChanged'], 'decision');
    if (!decisionShape.ok) return decisionShape;
    if (value.decision.tripChanged !== true) return invalid('decision.tripChanged', 'DECISION_TRIP_CHANGED_REQUIRED');
    const snapshot = validateTripSnapshot(
      value.trip,
      requestType,
      requestType === 'TRIP_UPDATE' ? input.currentPlan : null,
    );
    if (!snapshot.ok) return snapshot;
  }

  const ui = validateUI(
    value.ui,
    requestType,
    value.trip,
    requestType === 'TRIP_UPDATE' ? input.currentPlan : null,
  );
  if (!ui.ok) return ui;
  return valid(value);
}

module.exports = {
  REQUEST_TYPES,
  SCHEMA_VERSION,
  parseStrictJsonContent,
  validatePipelineInput,
  validatePipelineEnvelope,
};
