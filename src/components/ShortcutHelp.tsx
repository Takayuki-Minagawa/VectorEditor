import { useState } from 'react';
import { useI18n } from '../i18n/useI18n';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const mod = isMac ? '\u2318' : 'Ctrl';

export default function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const t = useI18n((s) => s.t);

  const shortcuts = [
    { category: t('sc_basic'), items: [
      { keys: `${mod}+Z`, desc: t('sc_undo') },
      { keys: `${mod}+Shift+Z`, desc: t('sc_redo') },
      { keys: `${mod}+C`, desc: t('sc_copy') },
      { keys: `${mod}+V`, desc: t('sc_paste') },
      { keys: `${mod}+D`, desc: t('sc_duplicate') },
      { keys: `${mod}+A`, desc: t('sc_selectAll') },
      { keys: 'Delete', desc: t('sc_delete') },
      { keys: 'Escape', desc: t('sc_deselect') },
    ]},
    { category: t('sc_group'), items: [
      { keys: `${mod}+G`, desc: t('sc_groupCreate') },
      { keys: `${mod}+Shift+G`, desc: t('sc_groupRelease') },
    ]},
    { category: t('sc_move'), items: [
      { keys: isMac ? '\u2190\u2191\u2192\u2193' : 'Arrow Keys', desc: t('sc_move1') },
      { keys: `Shift+${isMac ? '\u2190\u2191\u2192\u2193' : 'Arrow'}`, desc: t('sc_move10') },
      { keys: `Alt+Drag`, desc: t('sc_cloneDrag') },
    ]},
    { category: t('sc_transform'), items: [
      { keys: `Shift+Rotate`, desc: t('sc_snapAngle') },
    ]},
    { category: t('sc_tool'), items: [
      { keys: 'V', desc: t('sc_selectTool') },
    ]},
  ];

  return (
    <>
      <button className="shortcut-help-btn" onClick={() => setOpen(true)} title={t('shortcutTitle')}>?</button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{t('shortcutTitle')}</span>
              <button className="modal-close" onClick={() => setOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {shortcuts.map((section) => (
                <div key={section.category} className="shortcut-section">
                  <div className="shortcut-category">{section.category}</div>
                  {section.items.map((item) => (
                    <div key={item.keys} className="shortcut-row">
                      <kbd className="shortcut-key">{item.keys}</kbd>
                      <span className="shortcut-desc">{item.desc}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
