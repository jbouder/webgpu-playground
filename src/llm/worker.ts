// WebLLM worker entry. Uses the library's own handler, which speaks the full
// engine protocol (load, streaming chat completions, structured output,
// interrupt) — so the main-thread `CreateWebWorkerMLCEngine` proxy just works.
// Keeping inference here is the whole point of the demo: the ~1-4 GB model and
// token generation stay off the main thread. The "Worker off" toggle swaps this
// out for a main-thread engine to *demonstrate* the jank we're avoiding.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg)
