/**
 * `initiative-app-sdk/manifest`: the contract as types, the app's one
 * definition, and checking a manifest before a deployment does.
 */

export * from "./contract.js";

export {
  defineApp,
  defineEndpoint,
  type Actor,
  type AfterConnectAnswer,
  type AfterConnectCall,
  type AppContext,
  type AppDefinition,
  type Call,
  type CallableEndpoint,
  type DashboardDeclaration,
  type EmittedEndpoint,
  type EndpointCall,
  type EndpointDeclaration,
  type Handoff,
  type Hooks,
  type ListingDeclaration,
  type Outcome,
  type Params,
  type ParamSpec,
  type ParamValue,
  type Result,
  type ReturnSpec,
  type RevokeCall,
  type ScheduleCall,
  type ScheduleDeclaration,
  type SurfaceCall,
  type SurfaceDeclaration,
  type WebhookCall,
  type WidgetDeclaration,
} from "./define.js";

export {
  MANIFEST_PATH,
  manifestSchema,
  validateDocument,
  validateManifest,
  type AppDocument,
  type ValidationProblem,
} from "./validate.js";

export type { Jwks, PublicJwk } from "./keys.js";
