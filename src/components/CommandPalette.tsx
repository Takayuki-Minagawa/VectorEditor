import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useUiStore } from '../store/useUiStore';
import { useI18n } from '../i18n/useI18n';
import { ALL_TOOLS } from '../domain/tools';
import {
  copyActive,
  deleteSelected,
  duplicateActive,
  pasteClipboard,
  selectAll,
} from '../utils/canvasCommands';
import Dialog from './Dialog';

interface EditorAction {
  id: string;
  label: string;
  keywords: string;
  shortcut?: string;
  disabled?: boolean;
  perform: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export default function CommandPalette() {
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const toggleLeftPanel = useUiStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel);
  const canvas = useEditorStore((state) => state.canvas);
  const clipboard = useEditorStore((state) => state.clipboard);
  const setClipboard = useEditorStore((state) => state.setClipboard);
  const pushHistory = useEditorStore((state) => state.pushHistory);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const historyLength = useEditorStore((state) => state.history.length);
  const isRestoring = useEditorStore((state) => state.isRestoring);
  const selectionCount = useEditorStore((state) => state.selectedObjectIds.length);
  const setActiveTool = useEditorStore((state) => state.setActiveTool);
  const toggleGrid = useEditorStore((state) => state.toggleGrid);
  const toggleSnap = useEditorStore((state) => state.toggleSnap);
  const toggleSnapToObjects = useEditorStore((state) => state.toggleSnapToObjects);
  const toggleRulers = useEditorStore((state) => state.toggleRulers);
  const toggleOrtho = useEditorStore((state) => state.toggleOrtho);
  const toggleTheme = useEditorStore((state) => state.toggleTheme);
  const t = useI18n((state) => state.t);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        if (isRestoring) return;
        if (isEditableTarget(event.target) && !open) return;
        if (!open && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        event.preventDefault();
        setQuery('');
        setActiveIndex(0);
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRestoring, open, setOpen]);

  const run = (perform: () => void) => {
    perform();
    setOpen(false);
  };

  const actions = useMemo<EditorAction[]>(() => {
    const canvasActions: EditorAction[] = [
      { id: 'undo', label: t('undo'), keywords: 'undo history', shortcut: '⌘/Ctrl+Z', disabled: isRestoring || historyIndex <= 0, perform: undo },
      { id: 'redo', label: t('redo'), keywords: 'redo history', shortcut: '⌘/Ctrl+Shift+Z', disabled: isRestoring || historyIndex >= historyLength - 1, perform: redo },
      { id: 'select-all', label: t('selectAll'), keywords: 'selection all', shortcut: '⌘/Ctrl+A', disabled: !canvas, perform: () => { if (canvas) selectAll(canvas); } },
      { id: 'copy', label: t('ctx_copy'), keywords: 'clipboard copy', shortcut: '⌘/Ctrl+C', disabled: !canvas || selectionCount === 0, perform: () => { if (canvas) copyActive(canvas, setClipboard); } },
      { id: 'paste', label: t('ctx_paste'), keywords: 'clipboard paste', shortcut: '⌘/Ctrl+V', disabled: !canvas || !clipboard, perform: () => { if (canvas) pasteClipboard(canvas, clipboard, setClipboard, pushHistory); } },
      { id: 'duplicate', label: t('duplicate'), keywords: 'clone duplicate', shortcut: '⌘/Ctrl+D', disabled: !canvas || selectionCount === 0, perform: () => { if (canvas) duplicateActive(canvas, pushHistory); } },
      { id: 'delete', label: t('delete'), keywords: 'remove delete', shortcut: 'Delete', disabled: !canvas || selectionCount === 0, perform: () => { if (canvas) deleteSelected(canvas, pushHistory); } },
      { id: 'toggle-tools', label: t('toggleToolsPanel'), keywords: 'panel sidebar tools', perform: toggleLeftPanel },
      { id: 'toggle-properties', label: t('togglePropertiesPanel'), keywords: 'panel sidebar properties layers', perform: toggleRightPanel },
      { id: 'toggle-grid', label: t('toggleGridCommand'), keywords: 'grid view', perform: toggleGrid },
      { id: 'toggle-grid-snap', label: t('toggleGridSnapCommand'), keywords: 'grid snap', perform: toggleSnap },
      { id: 'toggle-object-snap', label: t('snapToObjects'), keywords: 'osnap object endpoint midpoint', perform: toggleSnapToObjects },
      { id: 'toggle-rulers', label: t('rulers'), keywords: 'ruler guide', perform: toggleRulers },
      { id: 'toggle-ortho', label: t('ortho'), keywords: 'orthogonal angle', perform: toggleOrtho },
      { id: 'toggle-theme', label: t('tip_theme'), keywords: 'theme dark light', perform: toggleTheme },
    ];
    return [
      ...canvasActions,
      ...ALL_TOOLS.map((tool) => ({
        id: `tool-${tool.tool}`,
        label: `${t('activateTool')}: ${t(tool.labelKey)}`,
        keywords: `tool ${tool.tool} ${tool.category}`,
        perform: () => setActiveTool(tool.tool),
      })),
    ];
  }, [canvas, clipboard, historyIndex, historyLength, isRestoring, pushHistory, redo, selectionCount, setActiveTool, setClipboard, t, toggleGrid, toggleLeftPanel, toggleOrtho, toggleRightPanel, toggleRulers, toggleSnap, toggleSnapToObjects, toggleTheme, undo]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return actions;
    return actions.filter((action) => {
      const haystack = `${action.label} ${action.keywords}`.toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [actions, query]);

  const activeAction = filtered[activeIndex];

  useEffect(() => {
    if (!open || !activeAction) return;
    document.getElementById(`command-option-${activeAction.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeAction, open]);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isRestoring) {
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      const action = filtered[activeIndex];
      if (action && !action.disabled) run(action.perform);
    }
  };

  if (!open) return null;

  return (
    <Dialog title={t('commandPalette')} onClose={() => setOpen(false)} closeLabel={t('measureClose')} className="command-palette-dialog">
      <div className="command-palette-body">
        <label className="sr-only" htmlFor="command-palette-search">{t('searchCommands')}</label>
        <input
          ref={inputRef}
          id="command-palette-search"
          className="command-search"
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={handleInputKeyDown}
          placeholder={t('searchCommands')}
          autoComplete="off"
          data-autofocus
          role="combobox"
          aria-autocomplete="list"
          aria-controls="command-results"
          aria-expanded="true"
          aria-activedescendant={activeAction ? `command-option-${activeAction.id}` : undefined}
        />
        <div id="command-results" className="command-results" role="listbox">
          {filtered.length === 0 && <p className="command-empty">{t('noCommands')}</p>}
          {filtered.map((action, index) => (
            <button
              key={action.id}
              id={`command-option-${action.id}`}
              className={`command-result ${index === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(action.perform)}
              disabled={action.disabled}
              role="option"
              aria-selected={index === activeIndex}
            >
              <span>{action.label}</span>
              {action.shortcut && <kbd>{action.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
