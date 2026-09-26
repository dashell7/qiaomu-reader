// Bridges the reader's AI contexts to Qiaomu Agent. Pure functions: main.js supplies the view state.
import { MAX_CONTEXT_TEXT, MAX_SELECTION_TEXT, clipText } from "./qiaomu-context.js";

export const AI_ASSISTANT_ROUTES = Object.freeze(["auto", "builtin", "agent"]);

/**
 * Which assistant answers "Ask AI". Automatic keeps the built-in AI once it is set up, and otherwise
 * uses Qiaomu Agent so the reader does not ask for a second API key. Unknown values mean automatic.
 */
export function shouldUseAgent(route, { builtinReady, agentAvailable }) {
  if (!agentAvailable) return false;
  if (route === "agent") return true;
  if (route === "builtin") return false;
  return !builtinReady;
}

/**
 * A reader AI context ({ kind, page, text, truncated?, bookFile }) as a Qiaomu Context snapshot.
 * `surrounding` is the current page or document text used when the context is a selection.
 */
export function readerSnapshot(sourceId, context, surrounding = null) {
  const file = context?.bookFile;
  if (!file) return null;
  const selection = context.kind === "selection" ? clipText(context.text, MAX_SELECTION_TEXT).text : "";
  const body = clipText(selection ? surrounding?.text : context.text, MAX_CONTEXT_TEXT);
  const location = String((selection ? surrounding?.page || context.page : context.page) || "").trim();
  return {
    sourceId,
    sourceName: "Qiaomu Reader English",
    kind: file.extension === "pdf" ? "document" : "book",
    title: String(file.basename || file.name || file.path),
    path: file.path,
    location: location || undefined,
    text: body.text || undefined,
    truncated: body.truncated || (selection ? surrounding?.truncated : context.truncated) === true || undefined,
    selection: selection ? { text: selection, location: String(context.page || "").trim() || undefined } : undefined,
  };
}
