import s from "./content-workspace.module.css";

export function SuggestedPrompts({ prompts, onSelect }: { prompts: readonly string[]; onSelect: (prompt: string) => void }) {
  return <div className={s.suggestions} aria-label="Suggested prompts">
    <p className={s.suggestionLabel}>A few useful places to start</p>
    <div className={s.suggestionList}>
      {prompts.slice(0, 3).map((prompt, index) => <button
        className={s.suggestion}
        key={`${index}:${prompt}`}
        type="button"
        onClick={() => onSelect(prompt)}
      >{prompt}</button>)}
    </div>
  </div>;
}
