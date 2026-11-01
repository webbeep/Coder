// `coder connect`: point Coder at any model server in one step.
import { readFileSync } from "node:fs"
import { parseArgs, str } from "../args"
import { readUserProviders, removeUserProvider, saveSecret, saveUserProvider, secretRef } from "../store"
import { ask, askSecret, bold, choose, confirm, cyan, dim, green, isInteractive, red, yellow } from "../ui"
import { buildProvider, FORMAT_LABELS, slugify } from "./formats"
import { type ApiFormat, probe } from "./probe"
import { checkToolCalling } from "./toolcheck"

const FORMATS: ApiFormat[] = ["openai-chat", "openai-responses", "anthropic", "gemini", "azure"]

export const CONNECT_HELP = `Usage: coder connect [URL] [options]

Connects Coder to a model server: a model on this laptop (Ollama, llama.cpp,
LM Studio) or a company server (vLLM, SGLang, LiteLLM, TGI, any OpenAI-,
Anthropic- or Gemini-compatible API, Azure OpenAI).

Options:
  --name NAME         Short name for this server (default: from the host)
  --key-env VAR       Read the API key from environment variable VAR when Coder starts
  --key-file PATH     Read the API key from this file now and store it in Coder's secrets
  --no-key            The server needs no API key
  --format FORMAT     Force a wire format: ${FORMATS.join(", ")}
  --models a,b        Only add these model ids (required for Azure deployments)
  --context N         Context window to use for every model, if the server doesn't report it
  --vision            Models accept images
  --default MODEL     Make this the default model (default: first model, if none is set)
  --no-test           Skip the tool-calling check
  --yes               Don't ask questions; use defaults

Other forms:
  coder connect --list            Show connected servers
  coder connect --remove NAME     Forget a server (its key file is kept)
`

export async function connectCommand(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["no-key", "vision", "no-test", "yes", "list", "help"])
  if (args.flags.help) {
    console.log(CONNECT_HELP)
    return 0
  }
  if (args.flags.list) return list()
  const removing = str(args, "remove")
  if (removing) {
    console.log(removeUserProvider(removing) ? `Removed ${removing}.` : `No server named ${removing}.`)
    return 0
  }
  const yes = Boolean(args.flags.yes) || !isInteractive()

  const url = args._[0] ?? (yes ? "" : ask("Model server URL (e.g. http://localhost:11434 or https://llm.yourco.internal/v1):"))
  if (!url) {
    console.error(red("A server URL is required.") + "\n\n" + CONNECT_HELP)
    return 2
  }

  // The key: env var reference, file, or typed (stored as a 0600 secret file).
  let apiKey: string | undefined
  let apiKeyRef: string | undefined
  const keyEnv = str(args, "key-env")
  const keyFile = str(args, "key-file")
  if (keyEnv) {
    apiKey = process.env[keyEnv]
    apiKeyRef = `{env:${keyEnv}}`
    if (!apiKey) console.log(yellow(`Note: ${keyEnv} is not set right now; the server check runs without a key.`))
  } else if (keyFile) {
    apiKey = readFileSync(keyFile, "utf8").trim()
  } else if (!args.flags["no-key"] && !yes) {
    apiKey = (await askSecret("API key (press Enter if the server needs none):")) || undefined
  }

  console.log(dim("Checking the server…"))
  const result = await probe(url, { apiKey })
  console.log(`${bold("Server:")} ${result.root}  ${dim(`(${result.kind})`)}`)
  for (const note of result.notes) console.log(yellow(`  ! ${note}`))
  if (result.authFailed && !apiKey) {
    console.log(red("The server requires an API key. Run again and enter it, or use --key-env / --key-file."))
    return 1
  }
  if (!result.formats.length) {
    console.log(red("Couldn't find a supported chat API at that address."))
    return 1
  }

  const forced = str(args, "format") as ApiFormat | undefined
  if (forced && !FORMATS.includes(forced)) {
    console.error(red(`Unknown format ${forced}. Use one of: ${FORMATS.join(", ")}`))
    return 2
  }
  if (forced && !result.formats.includes(forced)) {
    console.log(red(`The server doesn't answer the ${FORMAT_LABELS[forced]} endpoint.`))
    return 1
  }
  console.log(`${bold("APIs:")}   ${result.formats.map((f) => FORMAT_LABELS[f].split(" (")[0]).join(", ")}`)
  const format =
    forced ??
    (yes
      ? result.formats[0]!
      : choose(
          "Which API should Coder use?",
          result.formats.map((f) => ({ label: FORMAT_LABELS[f], value: f })),
        ))

  const only = str(args, "models")?.split(",").map((s) => s.trim()).filter(Boolean)
  if (!result.models.length && !only?.length) {
    console.log(red("The server listed no models. Pass the model ids with --models."))
    return 1
  }
  if (result.models.length) {
    console.log(bold(`Models (${result.models.length}):`))
    for (const m of result.models.slice(0, 30))
      console.log(`  - ${m.id}${m.context ? dim(`  context ${m.context.toLocaleString()}`) : ""}`)
    if (result.models.length > 30) console.log(dim(`  …and ${result.models.length - 30} more`))
  }
  let selected = only
  if (!selected && !yes && result.models.length > 1 && !confirm(`Add all ${result.models.length} models?`)) {
    selected = ask("Model ids to add, comma-separated:").split(",").map((s) => s.trim()).filter(Boolean)
  }

  const host = new URL(result.root).hostname
  const local = host === "localhost" || host.startsWith("127.") || host === "::1"
  const name = slugify(str(args, "name") ?? (yes ? (local ? "local" : host.split(".")[0]!) : ask("Name for this server:", local ? "local" : host.split(".")[0]!)))
  if (apiKey && !apiKeyRef) apiKeyRef = secretRef(name)

  const context = str(args, "context") ? Number(str(args, "context")) : undefined
  const entry = buildProvider(result, {
    displayName: str(args, "name") ?? name,
    format,
    apiKeyRef,
    only: selected,
    context,
    vision: Boolean(args.flags.vision),
  })
  const modelIds = Object.keys(entry.models)
  if (!modelIds.length) {
    console.log(red("No models selected."))
    return 1
  }

  if (!args.flags["no-test"]) {
    const testModel = modelIds[0]!
    console.log(dim(`Testing tool calling with ${testModel} (one short request)…`))
    const check = await checkToolCalling({ format, baseURL: result.baseURL[format]!, model: testModel, apiKey })
    if (check.ok) console.log(green(`  ✓ ${check.detail}`))
    else {
      console.log(yellow(`  ! Tool calling did not work: ${check.detail}`))
      console.log(
        yellow(
          "    Coder needs tool calls. For vLLM start with --enable-auto-tool-choice and the right --tool-call-parser;\n" +
            "    for llama.cpp use --jinja; for Ollama use a model whose template supports tools.",
        ),
      )
      if (!yes && !confirm("Save this server anyway?", false)) return 1
    }
  }

  if (apiKey && apiKeyRef === secretRef(name)) saveSecret(name, apiKey)
  const current = readUserProviders()
  const requested = str(args, "default")
  const makeDefault = requested ? `${name}/${requested}` : !current.model ? `${name}/${modelIds[0]}` : undefined
  saveUserProvider(name, entry, makeDefault)

  console.log(green(`\nConnected "${name}" with ${modelIds.length} model(s).`))
  if (makeDefault) console.log(`Default model: ${cyan(makeDefault)}`)
  console.log(dim("Start Coder with ./coder (terminal) or ./coder desktop."))
  return 0
}

function list(): number {
  const data = readUserProviders()
  const names = Object.keys(data.providers)
  if (!names.length) {
    console.log("No model servers connected yet. Run: coder connect")
    return 0
  }
  for (const n of names) {
    const p = data.providers[n]!
    console.log(`${bold(n)}  ${dim(String(p.settings.baseURL))}  ${dim(p.package.split("/").pop()!)}`)
    for (const m of Object.keys(p.models)) console.log(`  - ${n}/${m}${data.model === `${n}/${m}` ? green("  (default)") : ""}`)
  }
  return 0
}
