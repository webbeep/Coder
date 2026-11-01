// Code editor panel for Coder's desktop app: open any workspace file in a side tab,
// edit it with CodeMirror, save with Ctrl/Cmd+S. External changes (for example the
// agent editing the same file) reload automatically while you have no unsaved edits.
import { basicSetup } from "codemirror"
import { indentWithTab } from "@codemirror/commands"
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { oneDark } from "@codemirror/theme-one-dark"
import { Command, MenuItem, Panel, Plugin, Style, type MountedSession, type PanelTab, type SessionScreen } from "@opencode/plugin/gui"
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { languageFor } from "./languages"

const LAUNCHER = "open"
const FILE_PREFIX = "edit:"

const css = `
.coder-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.coder-editor__bar { display: flex; gap: 8px; align-items: center; padding: 4px 8px; font-size: 12px; opacity: .85;
  border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
.coder-editor__path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
.coder-editor__state--dirty { color: #d9a400; } .coder-editor__state--error { color: #e5484d; } .coder-editor__state--saved { color: #30a46c; }
.coder-editor__bar button { font: inherit; padding: 2px 8px; border-radius: 4px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; cursor: pointer; }
.coder-editor__host { flex: 1; min-height: 0; overflow: auto; }
.coder-editor__host .cm-editor { height: 100%; font-size: 13px; }
.coder-editor__notice { padding: 6px 8px; font-size: 12px; background: color-mix(in srgb, #d9a400 15%, transparent); }
.coder-open { padding: 8px; display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
.coder-open input { width: 100%; padding: 6px 8px; font: inherit; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; }
.coder-open ul { list-style: none; margin: 0; padding: 0; overflow: auto; }
.coder-open li button { width: 100%; text-align: left; padding: 4px 6px; border: 0; background: transparent; color: inherit; cursor: pointer;
  font-family: ui-monospace, monospace; font-size: 12px; border-radius: 4px; }
.coder-open li button:hover, .coder-open li button:focus { background: color-mix(in srgb, currentColor 10%, transparent); outline: none; }
`

const prefersDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches

function absolutePath(screen: SessionScreen, path: string): string {
  if (screen.file.absolute(path)) return path
  return `${screen.file.root.replace(/[\\/]+$/, "")}/${path}`
}

function FileEditor(props: { session: MountedSession; screen: SessionScreen; path: string }) {
  let host!: HTMLDivElement
  const [state, setState] = createSignal<"loading" | "clean" | "dirty" | "saving" | "saved" | "error">("loading")
  const [message, setMessage] = createSignal("")
  const [changedOnDisk, setChangedOnDisk] = createSignal(false)
  let view: EditorView | undefined
  let saved = ""
  const language = new Compartment()

  const save = async () => {
    if (!view) return
    const text = view.state.doc.toString()
    setState("saving")
    try {
      const location = props.session.location as { directory?: string } | undefined
      await props.session.server.client.experimental.file.write({
        location: location?.directory ? { directory: location.directory } : undefined,
        path: absolutePath(props.screen, props.path),
        payload: new TextEncoder().encode(text),
      })
      saved = text
      setChangedOnDisk(false)
      setState("saved")
      setTimeout(() => state() === "saved" && setState("clean"), 1500)
    } catch (e) {
      setState("error")
      setMessage(`Save failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const reload = (text: string) => {
    if (!view) return
    saved = text
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    setChangedOnDisk(false)
    setState("clean")
  }

  onMount(async () => {
    await props.screen.file.sync(props.path, { force: true })
    const file = props.screen.file.get(props.path)
    if (!file || file.notFound) {
      setState("error")
      setMessage("File not found.")
      return
    }
    if (file.content?.type !== "text") {
      setState("error")
      setMessage("This is a binary file; it can't be edited here.")
      return
    }
    saved = file.content.content
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: saved,
        extensions: [
          basicSetup,
          keymap.of([
            indentWithTab,
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                void save()
                return true
              },
            },
          ]),
          language.of([]),
          ...(prefersDark() ? [oneDark] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setState(update.state.doc.toString() === saved ? "clean" : "dirty")
          }),
        ],
      }),
    })
    setState("clean")
    void languageFor(props.path).then((support) => view?.dispatch({ effects: language.reconfigure(support) }))

    // The host reloads the file when it changes on disk (e.g. the agent edited it).
    createEffect(
      on(
        () => {
          const c = props.screen.file.get(props.path)?.content
          return c?.type === "text" ? c.content : undefined
        },
        (text) => {
          if (text === undefined || !view || text === saved) return
          if (view.state.doc.toString() === saved) reload(text)
          else setChangedOnDisk(true)
        },
        { defer: true },
      ),
    )
  })
  onCleanup(() => view?.destroy())

  return (
    <div class="coder-editor">
      <div class="coder-editor__bar">
        <span class="coder-editor__path" title={props.path}>
          {props.path}
        </span>
        <span class={`coder-editor__state--${state()}`}>
          {{ loading: "Loading…", clean: "", dirty: "● Unsaved", saving: "Saving…", saved: "Saved", error: "Error" }[state()]}
        </span>
        <button type="button" onClick={() => void save()} disabled={state() !== "dirty"} title="Save (Ctrl/Cmd+S)">
          Save
        </button>
      </div>
      <Show when={changedOnDisk()}>
        <div class="coder-editor__notice">
          This file changed on disk while you have unsaved edits.{" "}
          <button
            type="button"
            onClick={() => {
              const c = props.screen.file.get(props.path)?.content
              if (c?.type === "text") reload(c.content)
            }}
          >
            Load disk version
          </button>
        </div>
      </Show>
      <Show when={message()}>
        <div class="coder-editor__notice">{message()}</div>
      </Show>
      <div class="coder-editor__host" ref={host} />
    </div>
  )
}

function OpenFile(props: { screen: SessionScreen; open: (path: string) => void }) {
  const [query, setQuery] = createSignal("")
  const [results, setResults] = createSignal<string[]>([])
  let input!: HTMLInputElement
  let controller: AbortController | undefined
  createEffect(
    on(query, (q) => {
      controller?.abort()
      if (!q.trim()) return setResults([])
      controller = new AbortController()
      void props.screen.file
        .search(q, { kind: "file", limit: 50, signal: controller.signal })
        .then(setResults)
        .catch(() => {})
    }),
  )
  onMount(() => input.focus())
  return (
    <div class="coder-open">
      <input
        ref={input}
        placeholder="Type to find a file to edit…"
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results()[0]) props.open(results()[0]!)
        }}
      />
      <ul>
        <For each={results()}>
          {(path) => (
            <li>
              <button type="button" onClick={() => props.open(path)}>
                {path}
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}

export default Plugin.define({
  setup(ctx) {
    ctx.add(Style, css)
    const tabs = new Map<string, PanelTab>()

    const openFile = (session: MountedSession | undefined, path: string) => {
      if (!session) return
      ctx.layout.open(`${ctx.id}:${FILE_PREFIX}${path}`, session, { tab: "select" })
    }
    const openLauncher = () => {
      const session = ctx.sessions.current()
      if (session) ctx.layout.open(`${ctx.id}:${LAUNCHER}`, session, { tab: "select" })
    }

    ctx.add(Command, {
      id: "open",
      title: "Edit a file (code editor)",
      keywords: "code editor open file edit",
      bind: "mod+shift+e",
      run: () => openLauncher(),
    })
    ctx.add(MenuItem, { menu: "session.panel", id: "editor", title: "Code editor", run: () => openLauncher() })

    ctx.add(Panel, {
      id: "editor",
      region: "side",
      list: (input) =>
        input.open
          .filter((id) => id === LAUNCHER || id.startsWith(FILE_PREFIX))
          .map((id) => {
            const existing = tabs.get(id)
            if (existing) return existing
            const path = id.slice(FILE_PREFIX.length)
            const tab: PanelTab =
              id === LAUNCHER
                ? { id, title: "Open file to edit", transient: true }
                : { id, title: `✎ ${path.split("/").pop()}`, file: path }
            tabs.set(id, tab)
            return tab
          }),
      render: (props) => (
        <Show
          when={props.tab.id !== LAUNCHER}
          fallback={<OpenFile screen={props.screen} open={(path) => openFile(props.session, path)} />}
        >
          <FileEditor session={props.session} screen={props.screen} path={props.tab.id.slice(FILE_PREFIX.length)} />
        </Show>
      ),
      close: (input) => {
        tabs.delete(input.tab.id)
      },
    })
  },
})
