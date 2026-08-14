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

export {
  APP_PROTOCOL_VERSION,
  FEATURE_BLOCKS,
  MANIFEST_PATH,
  manifestSchema,
  validateManifest,
  type Connection,
  type ConnectionField,
  type ConnectionScope,
  type DataSource,
  type Embed,
  type Feature,
  type FieldType,
  type LocalizedText,
  type Manifest,
  type ParamType,
  type Requires,
  type SurfaceScope,
  type ValidationProblem,
  type Visibility,
  type Widget,
} from "./manifest.js";
