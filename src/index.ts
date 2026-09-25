/**
 * initiative-app-kit — the toolkit for apps that act in an Initiative community.
 *
 * - {@link generateAppKeys} / {@link loadPrivateKey}: the key your app signs with.
 * - {@link InitiativeAuth}: installation and member tokens, calling Initiative
 *   with them, calling another app through it, and the installation's own
 *   configuration.
 * - {@link verifyContextToken} / {@link verifyLifecycleToken} /
 *   {@link verifyHandoffToken}: checking Initiative's calls to your app and
 *   the members it sends to your surfaces.
 * - {@link handleHook}: answering the hooks Initiative calls while it runs a
 *   connection's flow.
 * - {@link verifyWebhook}: checking Initiative's webhook deliveries.
 * - {@link validateManifest}: checking your manifest before a deployment does.
 */

export {
  algorithmOf,
  generateAppKeys,
  loadPrivateKey,
  publicJwks,
  type AppKeyAlgorithm,
  type AppSigningKey,
  type GeneratedAppKeys,
  type Jwks,
  type PublicJwk,
} from "./keys.js";

export {
  ASSERTION_LIFETIME_SECONDS,
  CLIENT_ASSERTION_TYPE,
  ConsentRequiredError,
  GUILD_PATH_PLACEHOLDER,
  InitiativeApiError,
  InitiativeAuth,
  InitiativeAuthError,
  JWT_BEARER_GRANT,
  TOKEN_EXPIRY_SKEW_SECONDS,
  guildPath,
  initiativeResource,
  type AccessToken,
  type CallAppOptions,
  type ConfigStatus,
  type ConfigStatusReport,
  type ConnectionAccessToken,
  type ConsentRequest,
  type InitiativeAuthOptions,
  type Installation,
  type InstallationConfig,
  type InstallationConnection,
  type InstallationEvent,
  type InstallationTokenRequest,
  type MemberConnectionConfig,
  type MemberTokenRequest,
  type TokenNarrowing,
} from "./auth.js";

export {
  ContextTokenError,
  INITIATIVE_ISSUER,
  JWKS_CACHE_SECONDS,
  JWKS_PATH,
  JwksCache,
  audienceFor,
  bearerToken,
  verifyContextToken,
  verifyHandoffToken,
  verifyLifecycleToken,
  type ContextClaims,
  type ContextScope,
  type HandoffClaims,
  type InitiativeTokenClaims,
  type VerifyOptions,
} from "./context.js";

export {
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
  signWebhook,
  verifyWebhook,
  type WebhookVerification,
} from "./webhook.js";

export {
  HOOKS_PATH,
  HOOK_NAMES,
  handleHook,
  hookName,
  type AfterConnectAnswer,
  type AfterConnectCall,
  type HookHandlers,
  type HookName,
  type HookRequest,
  type HookResponse,
  type RevokeCall,
} from "./hooks.js";

export {
  ENDPOINTS_PATH,
  parseInvoke,
  type InvokeOutcome,
  type InvokeProblem,
  type InvokeRequest,
  type ParsedInvoke,
} from "./endpoints.js";

export {
  APP_WIDGET_TYPE_PREFIX,
  MAX_GRID_COLUMNS,
  MAX_WIDGETS,
  UID_ALPHABET,
  UID_LENGTH,
  appListing,
  appWidgetParts,
  appWidgetType,
  dashboardListing,
  isUid,
  mintUid,
  validateListing,
  type AppBinding,
  type DashboardDefinition,
  type DashboardWidget,
  type Listing,
  type ListingKind,
  type ListingMeta,
  type WidgetGrid,
} from "./listing.js";

export {
  APP_KIND,
  APP_PROTOCOL_VERSION,
  APP_SCOPE_PREFIX,
  CAPS,
  FEATURE_BLOCKS,
  MANIFEST_PATH,
  appDocument,
  appScope,
  isAppScope,
  manifestSchema,
  validateDocument,
  validateManifest,
  type ActorKind,
  type AppDocument,
  type AppScope,
  type BundledBinding,
  type BundledDashboard,
  type BundledDashboardWidget,
  type BundledGrid,
  type Connection,
  type ConnectionField,
  type ConnectionFlow,
  type ConnectionScope,
  type ConnectionToken,
  type Direction,
  type Embed,
  type EmbedCapability,
  type Endpoint,
  type EndpointIdentity,
  type EndpointReturn,
  type EndpointParam,
  type Feature,
  type FieldType,
  type FlowType,
  type JwtAlgorithm,
  type LocalizedText,
  type Manifest,
  type ParamType,
  type Requires,
  type ReturnValueType,
  type RevokeMethod,
  type Scope,
  type SurfaceScope,
  type TokenType,
  type ValidationProblem,
  type Vendor,
  type VendorField,
  type VendorFieldType,
  type Widget,
  templateNames,
} from "./manifest.js";

export { isPublicId } from "./parse.js";

/**
 * The contract itself: the vocabulary the types above are drawn from, exported
 * so a consumer can enumerate it rather than restate it.
 */
export {
  CHARSETS,
  FIELDS,
  ACTOR_KINDS,
  CONNECTION_SCOPES,
  DIRECTIONS,
  EMBED_CAPABILITIES,
  FEATURES,
  FIELD_TYPES,
  FLOW_TYPES,
  JWT_ALGORITHMS,
  PARAM_TYPES,
  REVOKE_METHODS,
  RETURN_VALUE_TYPES,
  SCOPES,
  SURFACE_SCOPES,
  TOKEN_TYPES,
  VENDOR_FIELD_TYPES,
} from "./contract.js";
