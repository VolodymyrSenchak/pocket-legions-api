import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Plan §3.2–3.3: engine/ and game/ are copied verbatim into the client, so they stay pure.
const SRC = __dirname;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

interface ImportRef {
  file: string;
  spec: string;
  typeOnly: boolean;
}

function imports(file: string): ImportRef[] {
  const text = fs.readFileSync(file, "utf8");
  const refs: ImportRef[] = [];
  const pattern = /^\s*(import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm;
  for (const match of text.matchAll(pattern)) {
    refs.push({ file: path.relative(SRC, file), spec: match[3], typeOnly: Boolean(match[2]) });
  }
  if (/\brequire\s*\(|\bimport\s*\(/.test(text)) {
    refs.push({ file: path.relative(SRC, file), spec: "<dynamic import or require>", typeOnly: false });
  }
  return refs;
}

function target(ref: ImportRef): string {
  if (!ref.spec.startsWith(".")) return ref.spec;
  return path.relative(SRC, path.resolve(SRC, path.dirname(ref.file), ref.spec)).split(path.sep).join("/");
}

describe("engine/ and game/ purity", () => {
  it("engine/ imports only from engine/", () => {
    const bad = sourceFiles(path.join(SRC, "engine"))
      .flatMap(imports)
      .filter((ref) => !target(ref).startsWith("engine/"));
    expect(bad).toEqual([]);
  });

  it("game/ imports from engine/, game/ and zod, plus types from models/ and the GameModule interface", () => {
    const allowed = (ref: ImportRef) => {
      const to = target(ref);
      if (to.startsWith("engine/") || to.startsWith("game/") || to === "zod") return true;
      return ref.typeOnly && (to.startsWith("models/") || to === "games/gameModule");
    };
    const bad = sourceFiles(path.join(SRC, "game")).flatMap(imports).filter((ref) => !allowed(ref));
    expect(bad).toEqual([]);
  });

  it("never reads the clock or Math.random", () => {
    const offenders = [...sourceFiles(path.join(SRC, "engine")), ...sourceFiles(path.join(SRC, "game"))].flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return [/Math\.random\s*\(/, /Date\.now\s*\(/, /new Date\(\s*\)/, /\bprocess\./]
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${path.relative(SRC, file)}: ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });

  it("the client set in client-sync.json imports nothing outside itself except zod", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "..", "client-sync.json"), "utf8")) as {
      folders: string[];
      files: string[];
      dependencies: string[];
    };
    const fromRoot = (entry: string) => path.join(SRC, "..", entry);
    const files = [...manifest.folders.flatMap((folder) => sourceFiles(fromRoot(folder))), ...manifest.files.map(fromRoot)];
    const inSet = new Set(files.map((file) => path.relative(SRC, file).split(path.sep).join("/").replace(/\.ts$/, "")));
    const bad = files
      .flatMap(imports)
      .filter((ref) => !(inSet.has(target(ref)) || manifest.dependencies.includes(target(ref))));
    expect(bad).toEqual([]);
    const impure = manifest.files.filter((file) => /Math\.random\s*\(|Date\.now\s*\(|new Date\(\s*\)|\bprocess\./.test(fs.readFileSync(fromRoot(file), "utf8")));
    expect(impure).toEqual([]);
  });

  it("finds the files it checks", () => {
    expect(sourceFiles(path.join(SRC, "engine")).length).toBeGreaterThan(5);
    expect(sourceFiles(path.join(SRC, "game")).length).toBeGreaterThan(0);
  });
});
