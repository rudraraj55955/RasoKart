/**
 * Orval configuration — kept as plain ESM (.mjs) intentionally.
 *
 * Background: the former orval.config.ts was loaded by Orval via the jiti
 * bundler (which Orval uses internally for TypeScript configs). In this
 * environment jiti pulled in @scalar/json-magic as a transitive dependency,
 * which caused "Failed to resolve input" errors when the config was evaluated.
 * Switching to a plain .mjs file lets Node load the config directly without
 * any bundler involvement, bypassing the issue entirely.
 *
 * clean: true is intentional and safe — the generated/ directories contain
 * only Orval-generated files (no hand-written code). Letting Orval wipe and
 * rewrite them on every codegen run prevents stale files from accumulating
 * when endpoints are renamed or removed from the spec.
 */
import { defineConfig } from "orval";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

const titleTransformer = (config) => {
  config.info ??= {};
  config.info.title = "Api";
  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
