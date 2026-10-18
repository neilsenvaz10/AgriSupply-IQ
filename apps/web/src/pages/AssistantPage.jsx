import { useState } from 'react';
import { MaterialIcon } from '../components/ui/MaterialIcon';
import { DataState } from '../components/ui/DataState';
import { PreviewBadge } from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useCopilot } from '../services/agri';

/** Generic starter questions (no commodity, place or number). They only fill the input. */
const PROMPTS = [
  'Which mandi gives the highest profit today?',
  'What if diesel prices rise?',
  'Should I sell now or wait?',
];

/** AI Copilot (Stitch: fasalytics_ai_copilot). Chat layout without any assistant behind it. */
export function AssistantPage() {
  useDocumentTitle('AI Copilot');
  const copilot = useCopilot();
  const [draft, setDraft] = useState('');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-space-sm">
      <header className="flex flex-wrap items-center justify-between gap-space-sm rounded-2xl bg-surface-container-lowest p-space-sm shadow-sm">
        <div className="flex min-w-0 items-center gap-space-sm">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary"
            aria-hidden="true"
          >
            <MaterialIcon name="smart_toy" />
          </span>
          <div className="min-w-0">
            <h1
              id="page-title"
              className="font-headline-sm text-headline-sm font-extrabold text-primary"
            >
              AI Copilot
            </h1>
            <p className="font-label-xs text-label-xs text-on-surface-variant">
              Ask about markets in English, हिंदी or मराठी once it is configured.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-space-xs">
          <span className="rounded-full bg-surface-container-high px-2.5 py-1 font-label-xs text-label-xs font-bold uppercase text-on-surface-variant">
            Not configured
          </span>
          <PreviewBadge />
          <button
            type="button"
            disabled
            aria-label="Voice input (not available)"
            title="Voice input is not available yet"
            className="flex h-10 w-10 cursor-not-allowed items-center justify-center rounded-full bg-surface-container-high text-outline"
          >
            <MaterialIcon name="mic_off" />
          </button>
        </div>
      </header>

      <section
        aria-label="Conversation"
        role="log"
        aria-live="polite"
        className="flex min-h-[320px] flex-col justify-center rounded-2xl bg-surface-container-low p-space-md"
      >
        <DataState state={copilot} icon="smart_toy">
          {() => null}
        </DataState>
      </section>

      <div
        className="flex gap-space-xs overflow-x-auto pb-1"
        role="group"
        aria-label="Suggested questions"
      >
        {PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setDraft(prompt)}
            className="shrink-0 rounded-full bg-surface-container-high px-4 py-2 font-label-md text-label-md text-on-surface"
          >
            {prompt}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => event.preventDefault()}
        className="flex items-center gap-space-xs rounded-full bg-surface-container-lowest p-1.5 shadow-md"
      >
        <label htmlFor="copilot-input" className="sr-only">
          Ask the AI Copilot
        </label>
        <input
          id="copilot-input"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask in English, हिंदी, or मराठी…"
          autoComplete="off"
          aria-describedby="copilot-send-reason"
          className="min-h-[44px] flex-1 bg-transparent px-3 font-body-md text-body-md outline-none placeholder:text-outline"
        />
        <button
          type="submit"
          disabled
          aria-disabled="true"
          aria-label="Send (not available)"
          className="flex h-11 w-11 cursor-not-allowed items-center justify-center rounded-full bg-primary text-on-primary opacity-50"
        >
          <MaterialIcon name="send" />
        </button>
      </form>
      <p
        id="copilot-send-reason"
        className="text-center font-label-xs text-label-xs text-on-surface-variant"
      >
        Sending is disabled: the AI Copilot is not connected, so no question is sent or answered.
      </p>
    </div>
  );
}
