export {
  canonicalJson,
  assertJsonObject,
  CanonicalJsonError,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from './canonical-json.js';

export {
  AUDIT_HASH_VERSION,
  GENESIS_HASH,
  auditHash,
  auditPreimage,
  verifyAuditChain,
  type AuditActorType,
  type AuditChainLink,
  type AuditChainVerification,
  type AuditEventBody,
  type AuditHead,
} from './audit.js';

export {
  createLogger,
  isLogLevel,
  LOG_LEVELS,
  REDACTED,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from './logger.js';

export {
  env,
  loadEnv,
  resetEnvCache,
  EnvError,
  INSECURE_DEV_AUTH_SECRET,
  type Env,
} from './env.js';

export {
  DOWNLOAD_LINK_SECONDS,
  expiryIn,
  signDownload,
  verifyDownload,
  type DownloadCheck,
  type DownloadGrant,
} from './signing.js';

export {
  describeValue,
  isAnswered,
  parseResponseValue,
  ResponseValueError,
  type ResponseValue,
} from './response.js';

export {
  countItems,
  instantiateBody,
  parseTemplateBody,
  templateBodySchema,
  templateItemSchema,
  templateSectionSchema,
  templateSourceSchema,
  ITEM_TYPES,
  ITEM_TYPE_LABELS,
  TemplateBodyError,
  type ItemType,
  type TemplateBody,
  type TemplateBodyInput,
  type TemplateItem,
  type TemplateItemInput,
  type TemplateSection,
  type TemplateSectionInput,
  type TemplateSource,
} from './template.js';

export {
  BUILTIN_TEMPLATES,
  builtinItemCounts,
  findBuiltinTemplate,
  SOURCES,
  type BuiltinTemplate,
  type SourceKey,
} from './templates/index.js';

export {
  cadenceSchema,
  defaultCadence,
  describeCadence,
  inQuietHours,
  nextRunAt,
  parseCadence,
  quietHoursSchema,
  timeOfDaySchema,
  type Cadence,
  type QuietHours,
  type ScheduleState,
  type TimeOfDay,
} from './cadence.js';

export {
  addZonedDays,
  atZonedTime,
  isValidTimezone,
  offsetMs,
  zonedParts,
  zonedTimeToUtc,
  InvalidTimezone,
  type ZonedParts,
} from './timezone.js';

export {
  assertCan,
  can,
  canAssignRole,
  matchesAdminList,
  permissionsFor,
  FIRM_ROLES,
  Forbidden,
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type FirmRole,
  type Permission,
} from './permissions.js';

export {
  checkSeats,
  checkStorage,
  effectivePlan,
  planIncludes,
  FEATURES,
  PLAN_DEFINITIONS,
  PLANS,
  type Feature,
  type Plan,
  type PlanDefinition,
  type UsageCheck,
} from './plans.js';
