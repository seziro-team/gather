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
