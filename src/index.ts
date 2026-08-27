/**
 * initiative-app-kit — the protocol half of writing an Initiative app.
 *
 * What an app has to get exactly right is the boundary: proving who it is,
 * checking who is calling, and describing itself in a way a deployment accepts.
 * That is what this package is. Everything above it — your vendor's API, your
 * storage, your framework — is yours, and the kit takes no view on it.
 *
 * Start from the reference app rather than from here: `initiative-github` is a
 * real, public, working app that exercises the widest slice of this protocol,
 * and cloning it gets you a correct skeleton instead of a blank file. This
 * package is what that app imports.
 *
 * @see https://github.com/Morelitea/initiative-github
 */

export {
  APP_HEADER,
  MAX_NONCE_LENGTH,
  NONCE_HEADER,
  SIGNATURE_HEADER,
  SIGNATURE_WINDOW_SECONDS,
  TIMESTAMP_HEADER,
  answerChallenge,
  mintNonce,
  signRequest,
  signedHeaders,
  signingMaterial,
  verifyRequest,
  type VerifyFailure,
  type VerifyResult,
} from "./signing.js";

export { createVault, type Vault } from "./vault.js";

export { CHALLENGE_METHOD, challengeFor, mintPkce, type Pkce } from "./pkce.js";

export {
  OUTCOME_PARAM,
  RETURN_SIGNATURE_PARAM,
  RETURN_URL_PARAM,
  landingUrl,
  returnAddress,
  signReturnUrl,
  type ConnectOutcome,
} from "./landing.js";

export {
  CHANNEL_BASE,
  ChannelError,
  InitiativeChannel,
  type ChannelOptions,
  type ConnectionStatus,
  type ConnectionWrite,
  type InstallConfig,
  type InstallSummary,
  type MemberConfig,
  type StatusRead,
  type StatusReport,
} from "./channel.js";

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
  ContextTokenError,
  JWKS_CACHE_SECONDS,
  JWKS_PATH,
  JwksCache,
  audienceFor,
  bearerToken,
  verifyContextToken,
  type ContextClaims,
  type ContextScope,
} from "./context.js";

export { isDigits, isPublicId, stripTrailingSlashes } from "./parse.js";

export {
  ENDPOINTS_PATH,
  parseInvoke,
  type InvokeOutcome,
  type InvokeProblem,
  type InvokeRequest,
  type ParsedInvoke,
} from "./endpoints.js";

export {
  DELEGATE_HEADER,
  DelegationTokenError,
  delegateHeader,
  delegateJwksPath,
  verifyDelegationToken,
  type DelegationClaims,
  type DelegationSigner,
} from "./delegation.js";

export {
  APP_RESOURCE_TYPE,
  APP_SOURCE_TYPE,
  DELIVERY_USER_AGENT,
  EVENT_ID_HEADER,
  Emitter,
  SUBSCRIPTIONS_PATH,
  deliveryEventId,
  eventEnvelope,
  isPublicTarget,
  mintSubscriptionSecret,
  parseSubscribe,
  signDelivery,
  subjectOf,
  verifyDelivery,
  type AppChange,
  type AppSubject,
  type DeliveryOutcome,
  type Emission,
  type EmitterOptions,
  type EventEnvelope,
  type ParsedSubscribe,
  type SubscribeProblem,
  type SubscribeRequest,
  type SubscribeResponse,
  type Subscription,
  type SubscriptionStore,
} from "./emit.js";

export {
  APP_KIND,
  APP_PROTOCOL_VERSION,
  CAPS,
  FEATURE_BLOCKS,
  MANIFEST_PATH,
  appDocument,
  checkLanguages,
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
  type ParamConstraints,
  type ResourceKind,
  type SelectOption,
  type SourceParam,
  type ValueSource,
  type Feature,
  type FieldType,
  type LocalizedText,
  type Manifest,
  type ParamType,
  type Requires,
  type ReturnValueType,
  type SurfaceScope,
  type ValidationProblem,
  type Visibility,
  type Widget,
} from "./manifest.js";

/**
 * The contract itself: the vocabulary every one of the types above is drawn
 * from, exported so a consumer can enumerate it rather than restate it.
 */
export {
  AUTOMATION_VOCABULARY_REF,
  AUTOMATION_VOCABULARY_VERSION,
  CHARSETS,
  FIELDS,
  RESOURCE_KINDS,
  VISIBILITY_LADDER,
  ACTOR_KINDS,
  CONNECTION_SCOPES,
  DIRECTIONS,
  EMBED_CAPABILITIES,
  FEATURES,
  FIELD_TYPES,
  PARAM_TYPES,
  RETURN_VALUE_TYPES,
  SURFACE_SCOPES,
  VISIBILITIES,
} from "./contract.js";
