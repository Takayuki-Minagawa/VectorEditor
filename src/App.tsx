import { useEffect, useState } from 'react';
import './App.css';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import ToolPanel from './components/ToolPanel';
import PropertyPanel from './components/PropertyPanel';
import StatusBar from './components/StatusBar';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAutoSave, loadAutoSave } from './hooks/useAutoSave';
import { useEditorStore } from './store/useEditorStore';

function App() {
  const [restored, setRestored] = useState(false);
  const canvas = useEditorStore((s) => s.canvas);

  useKeyboardShortcuts();
  useAutoSave();

  // Restore from auto-save on startup
  useEffect(() => {
    if (!canvas || restored) return;
    const saved = loadAutoSave();
    if (saved) {
      const { setCanvasSize, setBackgroundColor, pushHistory } = useEditorStore.getState();
      setCanvasSize(saved.canvas.width, saved.canvas.height);
      setBackgroundColor(saved.canvas.backgroundColor);
      const json = JSON.parse(saved.objects);
      canvas.loadFromJSON(json).then(() => {
        canvas.requestRenderAll();
        pushHistory();
        setRestored(true);
      });
    } else {
      setRestored(true);
    }
  }, [canvas, restored]);

  return (
    <div className="app">
      <Toolbar />
      <div className="app-body">
        <ToolPanel />
        <Canvas />
        <PropertyPanel />
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
