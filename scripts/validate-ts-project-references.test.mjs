import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

const validatorPath = fileURLToPath(
  new URL("./validate-ts-project-references.mjs", import.meta.url),
);
const fixtureDirectories = [];

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function writeFile(repositoryRoot, relativePath, contents) {
  const filePath = path.join(repositoryRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createRepository({ rootReferences, libraries, fileOverrides = {} }) {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "ts-project-references-"),
  );
  fixtureDirectories.push(repositoryRoot);

  writeFile(
    repositoryRoot,
    "tsconfig.json",
    `{
      // Root references may use directory or explicit config paths.
      "files": [],
      "references": ${JSON.stringify(rootReferences)}
    }\n`,
  );

  for (const library of libraries) {
    writeFile(
      repositoryRoot,
      `lib/${library.directory}/package.json`,
      `${JSON.stringify(
        {
          name: library.name,
          version: "0.0.0",
          ...library.dependencySections,
        },
        null,
        2,
      )}\n`,
    );
    writeFile(
      repositoryRoot,
      `lib/${library.directory}/tsconfig.json`,
      `{
        // Comments and trailing commas are valid in tsconfig files.
        "compilerOptions": {
          "composite": true,
        },
        "references": ${JSON.stringify(library.references ?? [])},
      }\n`,
    );
  }

  for (const [relativePath, contents] of Object.entries(fileOverrides)) {
    writeFile(repositoryRoot, relativePath, contents);
  }

  return repositoryRoot;
}

function runValidator(repositoryRoot) {
  return execFileSync(process.execPath, [validatorPath, repositoryRoot], {
    encoding: "utf8",
  });
}

function runFailingValidator(repositoryRoot) {
  return spawnSync(process.execPath, [validatorPath, repositoryRoot], {
    encoding: "utf8",
  });
}

test("accepts comments, both reference path forms, and every workspace dependency section", () => {
  const dependencySections = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];
  const libraries = [
    {
      directory: "base",
      name: "@fixture/base",
    },
    ...dependencySections.map((section, index) => ({
      directory: `consumer-${index}`,
      name: `@fixture/consumer-${index}`,
      dependencySections: { [section]: { "@fixture/base": "workspace:*" } },
      references: [{ path: "../base/tsconfig.json" }],
    })),
  ];
  const rootReferences = libraries.map((library, index) => ({
    path:
      index % 2 === 0
        ? `./lib/${library.directory}`
        : `./lib/${library.directory}/tsconfig.json`,
  }));
  const repositoryRoot = createRepository({ rootReferences, libraries });

  const output = runValidator(repositoryRoot);

  assert.match(output, /aligned for 5 buildable shared packages/);
});

test("does not require references for non-workspace dependencies in any dependency section", () => {
  const repositoryRoot = createRepository({
    rootReferences: [{ path: "./lib/base" }, { path: "./lib/consumer" }],
    libraries: [
      { directory: "base", name: "@fixture/base" },
      {
        directory: "consumer",
        name: "@fixture/consumer",
        dependencySections: {
          dependencies: {
            "@fixture/base": "^1.2.3",
            "registry-package": "1.0.0",
          },
          devDependencies: {
            "@fixture/base": "catalog:",
            "catalog-package": "catalog:testing",
          },
          optionalDependencies: {
            "@fixture/base": "file:../base",
            "tarball-package": "https://example.com/package.tgz",
          },
          peerDependencies: {
            "@fixture/base": "npm:@fixture/renamed-base@^1.0.0",
            "git-package": "git+https://example.com/package.git",
          },
        },
      },
    ],
  });

  const output = runValidator(repositoryRoot);

  assert.match(output, /aligned for 2 buildable shared packages/);
});

test("rejects a buildable library missing from the root references", () => {
  const repositoryRoot = createRepository({
    rootReferences: [],
    libraries: [{ directory: "base", name: "@fixture/base" }],
  });

  const result = runFailingValidator(repositoryRoot);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /@fixture\/base: tsconfig\.json is missing a reference to lib\/base\/tsconfig\.json/,
  );
});

test("rejects a workspace library dependency missing from library references", () => {
  const repositoryRoot = createRepository({
    rootReferences: [{ path: "./lib/base" }, { path: "./lib/consumer" }],
    libraries: [
      { directory: "base", name: "@fixture/base" },
      {
        directory: "consumer",
        name: "@fixture/consumer",
        dependencySections: {
          optionalDependencies: { "@fixture/base": "workspace:^" },
        },
      },
    ],
  });

  const result = runFailingValidator(repositoryRoot);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /@fixture\/consumer: lib\/consumer\/tsconfig\.json is missing a reference to workspace dependency @fixture\/base/,
  );
});

test("rejects a malformed library package.json and names the affected file", () => {
  const repositoryRoot = createRepository({
    rootReferences: [{ path: "./lib/base" }],
    libraries: [{ directory: "base", name: "@fixture/base" }],
    fileOverrides: {
      "lib/base/package.json": '{"name":"@fixture/base",',
    },
  });

  const result = runFailingValidator(repositoryRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TypeScript project reference validation failed:/);
  assert.match(result.stderr, /Could not read lib\/base\/package\.json:/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test("rejects an unreadable library package.json path and names the affected file", () => {
  const repositoryRoot = createRepository({
    rootReferences: [{ path: "./lib/base" }],
    libraries: [{ directory: "base", name: "@fixture/base" }],
  });
  const packagePath = path.join(repositoryRoot, "lib/base/package.json");
  fs.rmSync(packagePath);
  fs.mkdirSync(packagePath);

  const result = runFailingValidator(repositoryRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TypeScript project reference validation failed:/);
  assert.match(result.stderr, /Could not read lib\/base\/package\.json:/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test("rejects an unreadable root tsconfig.json path and names the affected file", () => {
  const repositoryRoot = createRepository({
    rootReferences: [],
    libraries: [],
  });
  const rootConfigPath = path.join(repositoryRoot, "tsconfig.json");
  fs.rmSync(rootConfigPath);
  fs.mkdirSync(rootConfigPath);

  const result = runFailingValidator(repositoryRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TypeScript project reference validation failed:/);
  assert.match(result.stderr, /Could not read tsconfig\.json:/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test("rejects a malformed library tsconfig.json and names the affected file", () => {
  const repositoryRoot = createRepository({
    rootReferences: [{ path: "./lib/base" }],
    libraries: [{ directory: "base", name: "@fixture/base" }],
    fileOverrides: {
      "lib/base/tsconfig.json": '{"compilerOptions":{"composite":true},',
    },
  });

  const result = runFailingValidator(repositoryRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TypeScript project reference validation failed:/);
  assert.match(result.stderr, /Could not read lib\/base\/tsconfig\.json:/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test("rejects an unreadable library tsconfig.json path and names the affected file", () => {
  const repositoryRoot = createRepository({
    rootReferences: [{ path: "./lib/base" }],
    libraries: [{ directory: "base", name: "@fixture/base" }],
  });
  const configPath = path.join(repositoryRoot, "lib/base/tsconfig.json");
  fs.rmSync(configPath);
  fs.mkdirSync(configPath);

  const result = runFailingValidator(repositoryRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TypeScript project reference validation failed:/);
  assert.match(result.stderr, /Could not read lib\/base\/tsconfig\.json:/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});
