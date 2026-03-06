import { useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKeys } from '../i18n/ja';

const APP_VERSION = '1.0.2';

interface Section {
  titleKey: TranslationKeys;
  bodyKey: TranslationKeys;
}

const sections: Section[] = [
  { titleKey: 'help_overview_title', bodyKey: 'help_overview_body' },
  { titleKey: 'help_tools_title', bodyKey: 'help_tools_body' },
  { titleKey: 'help_edit_title', bodyKey: 'help_edit_body' },
  { titleKey: 'help_file_title', bodyKey: 'help_file_body' },
  { titleKey: 'help_layer_title', bodyKey: 'help_layer_body' },
  { titleKey: 'help_cad_title', bodyKey: 'help_cad_body' },
  { titleKey: 'help_shortcut_title', bodyKey: 'help_shortcut_body' },
];

export default function HelpManual() {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const t = useI18n((s) => s.t);

  return (
    <>
      <button
        className="toolbar-btn"
        onClick={() => setOpen(true)}
        title={t('helpTitle')}
      >
        {t('helpBtn')}
      </button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="help-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{t('helpTitle')}</span>
              <button className="modal-close" onClick={() => setOpen(false)}>&times;</button>
            </div>
            <div className="help-body">
              <nav className="help-nav">
                {sections.map((sec, i) => (
                  <button
                    key={sec.titleKey}
                    className={`help-nav-item ${activeIdx === i ? 'active' : ''}`}
                    onClick={() => setActiveIdx(i)}
                  >
                    {t(sec.titleKey)}
                  </button>
                ))}
              </nav>
              <div className="help-content">
                <h3 className="help-section-title">{t(sections[activeIdx].titleKey)}</h3>
                <div className="help-section-body">
                  {t(sections[activeIdx].bodyKey).split('\n').map((line, i) => (
                    <p key={i} className={line === '' ? 'help-gap' : undefined}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
            <div className="help-footer">
              {t('help_version')}: {APP_VERSION}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
