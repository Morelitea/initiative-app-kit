/**
 * `initiative-app dev --initiative <url> --api-key <key>`: a declarative app
 * on your own deployment, uploaded again each time its source changes.
 *
 * Each pass builds the app, packs its listing file (`pack.ts`) and uploads it
 * with its picture, as the owner whose personal API key is given: the
 * deployment publishes it as its own app, on the shelf straight away. The
 * upload is versioned `<listing version>-dev.<digest of the file>`, since a
 * deployment publishes each version once; communities that installed the app
 * move to it from its Update button, or on their own if they follow updates.
 *
 * It watches the directory holding the app's definition, and builds again a
 * moment after the last change there.
 */

import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

import { bundler, compile } from "./build.js";
import { listingFile } from "./pack.js";

export interface DevOptions {
  /** The app's package directory. */
  root: string;
  /** The module whose default export is the app's definition, relative to `root`. */
  app: string;
  /** The deployment's address, such as `https://initiative.example.com`. */
  initiative: string;
  /** A personal API key of an account that may configure the deployment. */
  apiKey: string;
  /** Stops watching; `dev` then answers 0. */
  signal?: AbortSignal;
}

/** How long the source must be still before it is built again, in milliseconds. */
const SETTLE_MS = 200;

/** Upload the app, then again on each change. Answers the process's exit code. */
export async function dev(options: DevOptions): Promise<number> {
  const esbuild = await bundler("dev");
  if (!esbuild) return 1;
  const root = resolve(options.root);
  const base = options.initiative.replace(/\/+$/, "");
  let uploaded = "";

  /** Send one request as the key's owner; null when the deployment could not be reached. */
  const send = async (path: string, body: FormData | object) => {
    try {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          ...(body instanceof FormData ? {} : { "content-type": "application/json" }),
        },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
      return { status: response.status, text: (await response.text()).trim() };
    } catch (error) {
      process.stderr.write(`could not reach ${base}: ${(error as Error).message}\n`);
      return null;
    }
  };
  /** A refusal of the key itself ends the run: nothing later would be accepted either. */
  const refusedKey = (status: number) => status === 401 || status === 403;

  /** One pass. Answers an exit code to stop with, or null to keep watching. */
  const upload = async (): Promise<number | null> => {
    let packed;
    try {
      const compiled = await compile(esbuild, root, options.app);
      if (compiled.problems) {
        for (const problem of compiled.problems) process.stderr.write(`${problem}\n`);
        return null;
      }
      if (!compiled.app.hosts) {
        process.stderr.write(
          "dev uploads a declarative app; pack a container app's listing and register its service on the deployment\n"
        );
        return 1;
      }
      packed = listingFile(compiled.app, compiled.manifest, root);
    } catch (error) {
      process.stderr.write(`${(error as Error).message}\n`);
      return null;
    }
    const { listing, avatar } = packed;
    const digest = createHash("sha256").update(JSON.stringify(listing)).digest("hex").slice(0, 8);
    const version = `${listing.version}-dev.${digest}`;
    const name = `${listing.public_id} ${version}`;
    if (digest === uploaded) {
      process.stdout.write(`${name} is already uploaded\n`);
      return null;
    }
    if (avatar) {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(avatar)]), basename(String(listing.avatar_url)));
      const answer = await send("/api/v1/marketplace/local/media", form);
      if (!answer) return null;
      if (answer.status !== 201) {
        process.stderr.write(`the deployment refused the picture: ${answer.status} ${answer.text}\n`);
        return refusedKey(answer.status) ? 1 : null;
      }
      listing.avatar_url = (JSON.parse(answer.text) as { path: string }).path;
    }
    const answer = await send("/api/v1/marketplace/local/upload", { manifest: { ...listing, version } });
    if (!answer) return null;
    if (answer.status !== 201) {
      process.stderr.write(`the deployment refused ${name}: ${answer.status} ${answer.text}\n`);
      return refusedKey(answer.status) ? 1 : null;
    }
    uploaded = digest;
    process.stdout.write(`uploaded ${name} (uid ${listing.uid}): ${answer.status} ${answer.text}\n`);
    return null;
  };

  const first = await upload();
  if (first !== null) return first;
  if (options.signal?.aborted) return 0;

  const source = dirname(resolve(root, options.app));
  process.stdout.write(`watching ${relative(process.cwd(), source) || "."} for changes\n`);
  return new Promise((done) => {
    const watcher = watch(source, { recursive: true });
    let timer: NodeJS.Timeout | undefined;
    let running = false;
    let changed = false;
    const finish = (code: number) => {
      clearTimeout(timer);
      watcher.close();
      options.signal?.removeEventListener("abort", stop);
      done(code);
    };
    const stop = () => finish(0);
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(pass, SETTLE_MS);
    };
    const pass = async () => {
      if (running) {
        changed = true;
        return;
      }
      running = true;
      const code = await upload();
      running = false;
      if (code !== null) finish(code);
      else if (changed) {
        changed = false;
        settle();
      }
    };
    watcher.on("change", settle);
    watcher.on("error", (error) => {
      process.stderr.write(`stopped watching ${source}: ${error.message}\n`);
      finish(1);
    });
    options.signal?.addEventListener("abort", stop);
  });
}
