import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const repositoryRoot = path.resolve(process.argv[2] ?? process.cwd());
const librariesRoot = path.join(repositoryRoot, "lib");

function relative(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/") || ".";
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${relative(filePath)}: ${error.message}`);
  }
}

function readTsConfig(filePath) {
  const result = ts.readConfigFile(filePath, ts.sys.readFile);
  if (result.error) {
    throw new Error(
      `Could not read ${relative(filePath)}: ${ts.flattenDiagnosticMessageText(
        result.error.messageText,
        "\n",
      )}`,
    );
  }
  return result.config;
}

function referencedConfigPaths(configPath, config) {
  const configDirectory = path.dirname(configPath);
  return new Set(
    (config.references ?? []).map(({ path: referencePath }) => {
      const absolutePath = path.resolve(configDirectory, referencePath);
      return path.normalize(
        path.extname(absolutePath) ? absolutePath : path.join(absolutePath, "tsconfig.json"),
      );
    }),
  );
}

function findBuildableLibraries() {
  if (!fs.existsSync(librariesRoot)) {
    throw new Error(`Could not find shared library directory ${relative(librariesRoot)}`);
  }

  const libraries = [];
  for (const directoryEntry of fs.readdirSync(librariesRoot, { withFileTypes: true })) {
    if (!directoryEntry.isDirectory()) continue;

    const directory = path.join(librariesRoot, directoryEntry.name);
    const packagePath = path.join(directory, "package.json");
    const configPath = path.join(directory, "tsconfig.json");
    if (!fs.existsSync(packagePath) || !fs.existsSync(configPath)) continue;

    const packageJson = readJson(packagePath);
    const tsconfig = readTsConfig(configPath);
    if (tsconfig.compilerOptions?.composite !== true) continue;
    if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
      throw new Error(`Buildable library ${relative(packagePath)} has no package name`);
    }

    libraries.push({ directory, packagePath, configPath, packageJson, tsconfig });
  }
  return libraries;
}

function workspaceDependencyNames(packageJson) {
  const sections = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ];
  const names = new Set();
  for (const dependencies of sections) {
    for (const [name, version] of Object.entries(dependencies ?? {})) {
      if (typeof version === "string" && version.startsWith("workspace:")) names.add(name);
    }
  }
  return names;
}

function validate() {
  const rootConfigPath = path.join(repositoryRoot, "tsconfig.json");
  const rootConfig = readTsConfig(rootConfigPath);
  const libraries = findBuildableLibraries();
  const librariesByName = new Map(libraries.map((library) => [library.packageJson.name, library]));
  const rootReferences = referencedConfigPaths(rootConfigPath, rootConfig);
  const errors = [];

  for (const library of libraries) {
    if (!rootReferences.has(path.normalize(library.configPath))) {
      errors.push(
        `${library.packageJson.name}: ${relative(rootConfigPath)} is missing a reference to ${relative(
          library.configPath,
        )}`,
      );
    }

    const libraryReferences = referencedConfigPaths(library.configPath, library.tsconfig);
    for (const dependencyName of workspaceDependencyNames(library.packageJson)) {
      const dependency = librariesByName.get(dependencyName);
      if (!dependency) continue;
      if (!libraryReferences.has(path.normalize(dependency.configPath))) {
        errors.push(
          `${library.packageJson.name}: ${relative(
            library.configPath,
          )} is missing a reference to workspace dependency ${dependencyName} (${relative(
            dependency.configPath,
          )}) declared in ${relative(library.packagePath)}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error("TypeScript project reference validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `TypeScript project references are aligned for ${libraries.length} buildable shared packages.`,
  );
}

try {
  validate();
} catch (error) {
  console.error(`TypeScript project reference validation failed: ${error.message}`);
  process.exitCode = 1;
}