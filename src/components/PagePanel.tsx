import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { MAX_DOCUMENT_PAGES } from '../utils/documentSerializer';

export default function PagePanel() {
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const busy = useEditorStore((s) => s.isRestoring);
  const t = useI18n((s) => s.t);
  if (drawingMode !== 'illustration') return null;
  const state = useEditorStore.getState();
  const activeIndex = pages.findIndex((page) => page.id === activePageId);
  const run = (action: Promise<void>) => void action.catch(() => useEditorStore.getState().showToast(t('pageError'), 'error'));
  return (
    <div className="page-panel" aria-label={t('pages')}>
      <div className="prop-section-title">{t('pages')} ({pages.length}/{MAX_DOCUMENT_PAGES})</div>
      <div className="page-list">
        {pages.map((page) => (
          <button key={page.id} className={`page-item ${page.id === activePageId ? 'active' : ''}`}
            aria-current={page.id === activePageId ? 'page' : undefined}
            disabled={busy} onClick={() => run(state.switchPage(page.id))}>
            {page.name} · {page.canvas.width}×{page.canvas.height}
          </button>
        ))}
      </div>
      <label className="page-name-label">{t('pageName')}
        <input key={activePageId} defaultValue={pages[activeIndex]?.name ?? ''} maxLength={100}
          disabled={busy} onBlur={(event) => state.renamePage(activePageId, event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      </label>
      <div className="page-actions">
        <button disabled={busy || pages.length >= MAX_DOCUMENT_PAGES} onClick={() => run(state.addPage())}>{t('pageAdd')}</button>
        <button disabled={busy || pages.length >= MAX_DOCUMENT_PAGES} onClick={() => run(state.duplicatePage())}>{t('pageDuplicate')}</button>
        <button disabled={busy || activeIndex === 0} onClick={() => state.movePage(activePageId, -1)} aria-label={t('pageMoveUp')}>↑</button>
        <button disabled={busy || activeIndex === pages.length - 1} onClick={() => state.movePage(activePageId, 1)} aria-label={t('pageMoveDown')}>↓</button>
        <button disabled={busy || pages.length <= 1} onClick={() => run(state.deletePage(activePageId))}>{t('pageDelete')}</button>
      </div>
    </div>
  );
}
