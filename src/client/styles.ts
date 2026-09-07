const STYLE_ID = 'leisure-time-queue-styles'

const CSS = `
.ltq-card{list-style:none;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);overflow:hidden}
.ltq-card button,.ltq-card input,.ltq-card select,.ltq-card textarea{font:inherit}
.ltq-header{width:100%;border:0;background:none;color:inherit;text-align:left;display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer}
.ltq-header:focus-visible,.ltq-button:focus-visible,.ltq-input:focus-visible,.ltq-select:focus-visible,.ltq-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ltq-headcopy{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}.ltq-name{font-size:15px;font-weight:600}.ltq-description,.ltq-muted{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.ltq-body{border-top:.5px solid var(--dsw-alias-border-l2);padding:0 16px 16px}.ltq-section{padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}.ltq-section:last-child{border-bottom:0;padding-bottom:0}
.ltq-sectionhead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}.ltq-sectionhead h3,.ltq-sectionhead h4{margin:0;font-size:14px}.ltq-sectionhead p{margin:3px 0 0}
.ltq-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ltq-field{display:flex;flex-direction:column;gap:5px}.ltq-fieldwide{grid-column:1/-1}.ltq-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ltq-input,.ltq-select,.ltq-textarea{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:7px 9px}.ltq-textarea{min-height:78px;resize:vertical}
.ltq-toggle{display:flex;align-items:center;gap:8px;font-size:13px}.ltq-button{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);padding:6px 11px;cursor:pointer}.ltq-button:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}.ltq-buttonPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}.ltq-buttonDanger{color:var(--dsw-alias-label-error)}.ltq-button:disabled{opacity:.4;cursor:default}
.ltq-pathPicker{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;min-width:0}.ltq-pathValue{display:flex;align-items:center;box-sizing:border-box;min-width:0;min-height:34px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:7px 9px;font-size:12px}.ltq-pathValue span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.ltq-pathPlaceholder{color:var(--dsw-alias-label-tertiary)}.ltq-pathButton{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.ltq-iconButton{display:inline-grid;width:34px;height:34px;place-items:center;padding:0}
.ltq-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:center}.ltq-error{margin:10px 0 0;color:var(--dsw-alias-label-error);font-size:12px}.ltq-good{color:var(--dsw-alias-label-success)}
.ltq-windows{display:flex;flex-direction:column;gap:10px}.ltq-window{padding:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.ltq-windowtop{display:grid;grid-template-columns:1fr 90px 90px auto;gap:8px;align-items:end}.ltq-days{display:flex;flex-wrap:wrap;gap:5px}.ltq-day{display:flex;align-items:center;gap:3px;font-size:11px}
.ltq-badges{display:flex;flex-wrap:wrap;gap:5px}.ltq-badge{border-radius:999px;padding:2px 8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px}.ltq-badgeGood{color:var(--dsw-alias-label-success)}
.ltq-tasks{display:flex;flex-direction:column;gap:9px}.ltq-task{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-layer-1)}.ltq-taskhead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.ltq-tasktitle{font-size:13px;font-weight:600}.ltq-taskprompt{margin:7px 0;white-space:pre-wrap;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);max-height:92px;overflow:auto}.ltq-taskmeta{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}
@media(max-width:720px){.ltq-grid{grid-template-columns:1fr}.ltq-fieldwide{grid-column:auto}.ltq-windowtop{grid-template-columns:1fr 1fr}.ltq-days{grid-column:1/-1}.ltq-windowtop .ltq-button{justify-self:start}.ltq-pathPicker{grid-template-columns:minmax(0,1fr) auto}.ltq-pathValue{grid-column:1/-1}}
`

/** Install the card stylesheet once for the current document. */
export function installStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.append(style)
}
