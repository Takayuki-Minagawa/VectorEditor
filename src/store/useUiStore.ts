import { create } from 'zustand';

const STORAGE_KEY = 'vectoreditor-layout-v1';
const CURRENT_PROJECT_KEY = 'vectoreditor-current-project-v1';

interface StoredLayout {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
}

function loadLayout(): StoredLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<StoredLayout> | null;
    return {
      leftPanelOpen: parsed?.leftPanelOpen !== false,
      rightPanelOpen: parsed?.rightPanelOpen !== false,
    };
  } catch {
    return { leftPanelOpen: true, rightPanelOpen: true };
  }
}

function saveLayout(layout: StoredLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Layout persistence is optional when browser storage is unavailable.
  }
}

function loadCurrentProjectId(): string | null {
  try { return localStorage.getItem(CURRENT_PROJECT_KEY); } catch { return null; }
}

function saveCurrentProjectId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_PROJECT_KEY, id);
    else localStorage.removeItem(CURRENT_PROJECT_KEY);
  } catch {
    // Project selection remains valid for this session when storage is denied.
  }
}

interface UiStore extends StoredLayout {
  commandPaletteOpen: boolean;
  currentProjectId: string | null;
  setCommandPaletteOpen: (open: boolean) => void;
  setCurrentProjectId: (id: string | null) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
}

const initialLayout = loadLayout();

export const useUiStore = create<UiStore>((set) => ({
  ...initialLayout,
  commandPaletteOpen: false,
  currentProjectId: loadCurrentProjectId(),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setCurrentProjectId: (currentProjectId) => {
    saveCurrentProjectId(currentProjectId);
    set({ currentProjectId });
  },
  toggleLeftPanel: () => set((state) => {
    const layout = { leftPanelOpen: !state.leftPanelOpen, rightPanelOpen: state.rightPanelOpen };
    saveLayout(layout);
    return layout;
  }),
  toggleRightPanel: () => set((state) => {
    const layout = { leftPanelOpen: state.leftPanelOpen, rightPanelOpen: !state.rightPanelOpen };
    saveLayout(layout);
    return layout;
  }),
}));
