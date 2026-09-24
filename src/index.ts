/**
 * initiative-app-kit — the toolkit for apps that act in an Initiative community.
 *
 * - {@link generateAppKeys} / {@link loadPrivateKey}: the key your app signs with.
 * - {@link InitiativeAuth}: installation and member tokens, and calling
 *   Initiative with them.
 * - {@link verifyContextToken} / {@link verifyHandoffToken}: checking Initiative's
 *   calls to your app and the members it sends to your surfaces.
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
  type ConsentRequest,
  type InitiativeAuthOptions,
  type Installation,
  type InstallationTokenRequest,
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
  CAPS,
  FEATURE_BLOCKS,
  MANIFEST_PATH,
  appDocument,
  manifestSchema,
  validateDocument,
  validateManifest,
  type ActorKind,
  type AppDocument,
  type BundledBinding,
  type BundledDashboard,
  type BundledDashboardWidget,
  type BundledGrid,
  type Connection,
  type ConnectionField,
  type ConnectionScope,
  type Direction,
  type Embed,
  type EmbedCapability,
  type Endpoint,
  type EndpointIdentity,
  type EndpointReturn,
  type EndpointParam,
  type Feature,
  type FieldType,
  type LocalizedText,
  type Manifest,
  type ParamType,
  type Requires,
  type ReturnValueType,
  type Scope,
  type SurfaceScope,
  type ValidationProblem,
  type Widget,
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
  PARAM_TYPES,
  RETURN_VALUE_TYPES,
  SCOPES,
  SURFACE_SCOPES,
} from "./contract.js";
