/**
 * Design-tab inspector (contract §7): a widget-per-prop form for the selected
 * component, driven by the catalog's COMPOSERX_PROP_SPECS (§4d). Falls back
 * to generic JSON rows when no specs ever arrive (official sample renderer).
 * All prop names/values from specs and docs are DATA — rendered as text only.
 */
import { useState } from 'react';
import type { PropSpec } from '../lib/bridge-host';
import type { DocComponent } from '../lib/surface-doc';
import { GUARDED_PROP_KEYS, ROOT_ID, singleSlotParentOf } from '../lib/surface-doc';
import { useComposerState, useStore } from '../state/context';
import type { ActionResult } from '../state/store';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Contract §4d: a bound prop value has the shape `{path: string}`. */
function isBinding(value: unknown): value is { path: string } {
  return isRecord(value) && typeof value.path === 'string';
}

function jsonText(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

function compactJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

interface RowCallbacks {
  commit(key: string, value: unknown): ActionResult;
  remove(key: string): ActionResult;
}

function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      className="icon-button prop-remove"
      data-testid={`prop-${name}-remove`}
      title={`Remove prop "${name}"`}
      aria-label={`Remove prop ${name}`}
      onClick={onRemove}
    >
      ✕
    </button>
  );
}

function RowError({ name, error }: { name: string; error: string | null }) {
  if (!error) return null;
  return (
    <span className="error-text prop-error" data-testid={`prop-${name}-error`} role="alert">
      {error}
    </span>
  );
}

/** Read-only row for containment props (children/child/trigger/content/tabs). */
function ContainmentRow({ name, value }: { name: string; value: unknown }) {
  return (
    <div className="prop-row prop-row-containment">
      <span className="prop-label">
        {name}
        <span className="prop-flag" title="Containment — edit structurally or via JSON">
          containment
        </span>
      </span>
      <code className="prop-readonly" data-testid={`prop-${name}`}>
        {value === undefined ? '—' : compactJson(value)}
      </code>
    </div>
  );
}

/** One spec-driven prop row: kind widget, bind toggle, remove affordance. */
function SpecPropRow({
  spec,
  component,
  callbacks,
}: {
  spec: PropSpec;
  component: DocComponent;
  callbacks: RowCallbacks;
}) {
  const name = spec.name;
  const current = component[name];
  const bound = isBinding(current);
  const [bindMode, setBindMode] = useState(bound);
  const [error, setError] = useState<string | null>(null);

  if (spec.containment) {
    return <ContainmentRow name={name} value={current} />;
  }

  const present = name in component;
  const run = (value: unknown) => {
    const result = callbacks.commit(name, value);
    setError(result.ok ? null : result.error);
  };

  const commitText = (draft: string) => {
    const currentText = typeof current === 'string' ? current : undefined;
    if (draft === (currentText ?? '')) return; // unchanged (or still absent)
    run(draft);
  };

  const commitNumber = (draft: string) => {
    if (draft.trim() === '') return; // clear via the remove affordance instead
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setError(`"${draft}" is not a number`);
      return;
    }
    if (typeof current === 'number' && current === parsed) return;
    run(parsed);
  };

  const commitJson = (draft: string) => {
    if (draft.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (compactJson(parsed) === compactJson(current)) return;
    run(parsed);
  };

  const commitPath = (draft: string) => {
    if (draft.trim() === '') return;
    if (bound && current.path === draft) return;
    run({ path: draft });
  };

  const enterCommits = (e: React.KeyboardEvent<HTMLInputElement>, fn: (draft: string) => void) => {
    if (e.key === 'Enter') {
      fn(e.currentTarget.value);
      e.currentTarget.blur();
    }
  };

  let widget: React.ReactNode;
  if (bindMode) {
    widget = (
      <input
        type="text"
        className="prop-input"
        data-testid={`prop-${name}`}
        placeholder="/data/model/path"
        defaultValue={bound ? current.path : ''}
        onBlur={(e) => commitPath(e.target.value)}
        onKeyDown={(e) => enterCommits(e, commitPath)}
      />
    );
  } else {
    switch (spec.kind) {
      case 'boolean':
        widget = (
          <input
            type="checkbox"
            data-testid={`prop-${name}`}
            checked={current === true}
            onChange={(e) => run(e.target.checked)}
          />
        );
        break;
      case 'enum': {
        const value = typeof current === 'string' && spec.options?.includes(current) ? current : '';
        widget = (
          <select
            className="prop-input"
            data-testid={`prop-${name}`}
            value={value}
            onChange={(e) => run(e.target.value)}
          >
            {value === '' && <option value="" disabled />}
            {(spec.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
        break;
      }
      case 'number':
        widget = (
          <input
            type="number"
            className="prop-input"
            data-testid={`prop-${name}`}
            defaultValue={typeof current === 'number' ? String(current) : ''}
            onBlur={(e) => commitNumber(e.target.value)}
            onKeyDown={(e) => enterCommits(e, commitNumber)}
          />
        );
        break;
      case 'json':
        widget = (
          <textarea
            className="prop-json"
            data-testid={`prop-${name}`}
            spellCheck={false}
            rows={3}
            defaultValue={jsonText(current)}
            onBlur={(e) => commitJson(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                commitJson(e.currentTarget.value);
                e.currentTarget.blur();
              }
            }}
          />
        );
        break;
      default:
        widget = (
          <input
            type="text"
            className="prop-input"
            data-testid={`prop-${name}`}
            defaultValue={typeof current === 'string' ? current : ''}
            onBlur={(e) => commitText(e.target.value)}
            onKeyDown={(e) => enterCommits(e, commitText)}
          />
        );
        break;
    }
  }

  return (
    <div className={`prop-row prop-kind-${spec.kind}`}>
      <span className="prop-label">
        {name}
        {spec.required && (
          <span className="prop-required" title="Required prop" aria-label="required">
            *
          </span>
        )}
      </span>
      <div className="prop-widget">
        {spec.bindable && (
          <button
            className={`bind-toggle ${bindMode ? 'on' : ''}`}
            data-testid={`prop-${name}-bind`}
            title={bindMode ? 'Unbind — edit a literal value' : 'Bind to a data-model path'}
            aria-pressed={bindMode}
            onClick={() => {
              setBindMode(!bindMode);
              setError(null);
            }}
          >
            ◈
          </button>
        )}
        {widget}
        {!spec.required && present && (
          <RemoveButton
            name={name}
            onRemove={() => {
              const result = callbacks.remove(name);
              setError(result.ok ? null : result.error);
            }}
          />
        )}
      </div>
      <RowError name={name} error={error} />
    </div>
  );
}

/** Generic JSON row for props without a spec (advanced / no-specs fallback). */
function JsonPropRow({
  name,
  value,
  callbacks,
}: {
  name: string;
  value: unknown;
  callbacks: RowCallbacks;
}) {
  const [error, setError] = useState<string | null>(null);
  const commit = (draft: string) => {
    if (draft.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (compactJson(parsed) === compactJson(value)) return;
    const result = callbacks.commit(name, parsed);
    setError(result.ok ? null : result.error);
  };
  return (
    <div className="prop-row prop-kind-json">
      <span className="prop-label">{name}</span>
      <div className="prop-widget">
        <textarea
          className="prop-json"
          data-testid={`prop-${name}`}
          spellCheck={false}
          rows={2}
          defaultValue={jsonText(value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              commit(e.currentTarget.value);
              e.currentTarget.blur();
            }
          }}
        />
        <RemoveButton
          name={name}
          onRemove={() => {
            const result = callbacks.remove(name);
            setError(result.ok ? null : result.error);
          }}
        />
      </div>
      <RowError name={name} error={error} />
    </div>
  );
}

/** "Add prop" row for the no-specs fallback form. */
function AddPropRow({ callbacks }: { callbacks: RowCallbacks }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const key = name.trim();
    if (key === '') {
      setError('prop name is required');
      return;
    }
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // not JSON — commit the raw text as a string value
    }
    const result = callbacks.commit(key, parsed);
    if (result.ok) {
      setName('');
      setValue('');
      setError(null);
    } else {
      setError(result.error);
    }
  };
  return (
    <div className="prop-row prop-add-row">
      <div className="prop-widget">
        <input
          type="text"
          className="prop-input"
          data-testid="prop-add-name"
          placeholder="prop name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          className="prop-input"
          data-testid="prop-add-value"
          placeholder="value (JSON or text)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button data-testid="prop-add" onClick={add}>
          Add
        </button>
      </div>
      <RowError name="add" error={error} />
    </div>
  );
}

export function Inspector() {
  const store = useStore();
  const state = useComposerState();
  const selectedId = state.selectedComponentId;
  const component = selectedId ? state.doc.components.find((c) => c.id === selectedId) : undefined;

  if (!selectedId || !component) {
    return (
      <div className="inspector" data-testid="inspector">
        <p className="empty-note" data-testid="inspector-empty">
          Click a component on the canvas or in the tree to edit its props here.
        </p>
      </div>
    );
  }

  const callbacks: RowCallbacks = {
    commit: (key, value) => store.actions.commitProp(selectedId, key, value),
    remove: (key) => store.actions.removeProp(selectedId, key),
  };

  const slotParent = singleSlotParentOf(state.doc, selectedId);
  const isRoot = selectedId === ROOT_ID;
  const deleteDisabled = isRoot || slotParent !== null;
  const deleteHint = isRoot
    ? 'The root component cannot be deleted — clear the canvas instead.'
    : slotParent !== null
      ? `Fills a single slot of #${slotParent} — delete the parent, or edit via JSON.`
      : `Delete #${selectedId} and its subtree (Delete/Backspace)`;

  const specEntry = state.propSpecs?.[component.component];
  const specs = specEntry?.props ?? null;
  const specNames = new Set((specs ?? []).map((s) => s.name));
  const instanceProps = Object.entries(component).filter(
    ([key]) => key !== 'id' && key !== 'component',
  );

  // The rows re-key on doc revision so committed values (and undo) re-seed
  // the uncontrolled text widgets from the doc, the single source of truth.
  const formKey = `${selectedId}:${state.docRevision}`;

  let body: React.ReactNode;
  if (specs) {
    const advanced = instanceProps.filter(([key]) => !specNames.has(key));
    body = (
      <div key={formKey} className="prop-form">
        {specs.map((spec) => (
          <SpecPropRow key={spec.name} spec={spec} component={component} callbacks={callbacks} />
        ))}
        {advanced.length > 0 && (
          <section className="prop-advanced" data-testid="inspector-advanced">
            <h3>Advanced</h3>
            <p className="muted">Props on this instance without a spec — edited as raw JSON.</p>
            {advanced.map(([key, value]) =>
              GUARDED_PROP_KEYS.has(key) ? (
                <ContainmentRow key={key} name={key} value={value} />
              ) : (
                <JsonPropRow key={key} name={key} value={value} callbacks={callbacks} />
              ),
            )}
          </section>
        )}
      </div>
    );
  } else {
    body = (
      <div key={formKey} className="prop-form" data-testid="inspector-fallback">
        <p className="muted">
          No prop specs from this renderer — props are edited as raw JSON rows.
        </p>
        {instanceProps.map(([key, value]) =>
          GUARDED_PROP_KEYS.has(key) ? (
            <ContainmentRow key={key} name={key} value={value} />
          ) : (
            <JsonPropRow key={key} name={key} value={value} callbacks={callbacks} />
          ),
        )}
        <AddPropRow callbacks={callbacks} />
      </div>
    );
  }

  return (
    <div className="inspector" data-testid="inspector">
      <header className="inspector-header">
        <div className="inspector-title">
          <span className="inspector-type">{component.component}</span>
          <span className="inspector-id mono">#{selectedId}</span>
        </div>
        <button
          className="danger"
          data-testid="inspector-delete"
          disabled={deleteDisabled}
          title={deleteHint}
          onClick={() => store.actions.deleteSelected()}
        >
          Delete
        </button>
      </header>
      {deleteDisabled && !isRoot && (
        <p className="hint inspector-delete-hint" data-testid="inspector-delete-hint">
          {deleteHint}
        </p>
      )}
      {body}
    </div>
  );
}
