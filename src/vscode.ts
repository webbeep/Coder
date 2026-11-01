// `coder vscode`: build the extension, package it as a .vsix, and install it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { paths } from "./paths"
import { which } from "./platform"
import { dim, green, yellow } from "./ui"
import { createZip } from "./zip"

const EXT = join(paths.root, "vscode")

export async function buildVsix(): Promise<string> {
  const out = await Bun.build({
    entrypoints: [join(EXT, "src", "extension.ts")],
    outdir: join(EXT, "dist"),
    target: "node",
    format: "cjs",
    external: ["vscode"],
    minify: false,
  })
  if (!out.success) throw new Error("Extension build failed:\n" + out.logs.join("\n"))
  // Remember this checkout so the extension finds the launcher without settings.
  writeFileSync(join(EXT, "dist", "coder-root.json"), JSON.stringify({ root: paths.root }))

  const pkg = JSON.parse(readFileSync(join(EXT, "package.json"), "utf8"))
  const enc = new TextEncoder()
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${esc(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(pkg.description)}</Description>
    <Tags></Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`
  const types = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
`
  const file = (p: string) => new Uint8Array(readFileSync(join(EXT, p)))
  const zip = createZip([
    { path: "[Content_Types].xml", data: enc.encode(types) },
    { path: "extension.vsixmanifest", data: enc.encode(manifest) },
    { path: "extension/package.json", data: file("package.json") },
    { path: "extension/README.md", data: file("README.md") },
    { path: "extension/dist/extension.js", data: file("dist/extension.js") },
    { path: "extension/dist/coder-root.json", data: file("dist/coder-root.json") },
  ])
  mkdirSync(paths.local, { recursive: true })
  const vsix = join(paths.local, `coder-vscode-${pkg.version}.vsix`)
  writeFileSync(vsix, zip)
  return vsix
}

export async function vscodeCommand(argv: string[]): Promise<number> {
  const vsix = await buildVsix()
  console.log(`Built ${vsix}`)
  if (argv.includes("--package-only")) return 0
  const code = ["code", "code-insiders", "codium", "cursor"].map((c) => which(c)).find(Boolean)
  if (!code) {
    console.log(yellow("VS Code's `code` command was not found on PATH."))
    console.log(dim(`Install manually: Extensions view → … → Install from VSIX → ${vsix}`))
    return 0
  }
  const r = Bun.spawnSync([code, "--install-extension", vsix, "--force"], { stdout: "inherit", stderr: "inherit" })
  if (r.exitCode === 0) console.log(green("Installed. In VS Code: Ctrl+Esc (Cmd+Esc on Mac) opens Coder."))
  return r.exitCode ?? 1
}
