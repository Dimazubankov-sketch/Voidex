'use client';
import { useRef } from 'react';
import { Folder, Clock, Search, X } from 'lucide-react';
export function swipeDirection(dx: number, dy: number, threshold = 40) {
  return Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx < 0 ? 1 : -1) : 0;
}
export function keyboardInset(layout: number, height: number, offset: number, scale = 1) {
  return Math.abs(scale - 1) < 0.05 ? Math.max(0, layout - height - offset) : 0;
}
export function FileDock({
  section,
  searchOpen,
  keyboard,
  query,
  setQuery,
  navigate,
  openSearch,
  closeSearch,
  inputRef,
}: {
  section: string;
  searchOpen: boolean;
  keyboard: number;
  query: string;
  setQuery: (s: string) => void;
  navigate: (s: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const drag = useRef<{ x: number; y: number } | null>(null),
    suppress = useRef(false);
  return (
    <nav
      className={'vf-bottom ' + (searchOpen ? 'searching' : '')}
      style={{ '--vf-keyboard-inset': keyboard + 'px' } as React.CSSProperties}
      aria-label="Файлы и поиск"
      onPointerDown={(e) => {
        if (searchOpen || e.button !== 0) return;
        suppress.current = false;
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d && swipeDirection(e.clientX - d.x, e.clientY - d.y)) e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d) {
          const direction = swipeDirection(e.clientX - d.x, e.clientY - d.y);
          if (direction) {
            suppress.current = true;
            navigate(direction === 1 ? 'recent' : 'files');
          }
        }
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => (drag.current = null)}
      onClickCapture={(e) => {
        if (suppress.current) {
          e.preventDefault();
          e.stopPropagation();
          suppress.current = false;
        }
      }}
    >
      <div className="vf-bottom-tabs" inert={searchOpen}>
        <span className={'vf-dock-indicator ' + (section === 'recent' ? 'recent' : '')} />
        <button className={section !== 'recent' ? 'active' : ''} onClick={() => navigate('files')}>
          <Folder />
          <span>Файлы</span>
        </button>
        <button className={section === 'recent' ? 'active' : ''} onClick={() => navigate('recent')}>
          <Clock />
          <span>Недавние</span>
        </button>
        <button className="vf-bottom-search-toggle" onClick={openSearch} aria-label="Поиск">
          <Search />
        </button>
      </div>
      <div className="vf-bottom-search" inert={!searchOpen}>
        <Search size={20} />
        <input
          ref={inputRef}
          tabIndex={searchOpen ? 0 : -1}
          type="search"
          placeholder="Название файла или папки"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск файлов"
        />
        <button className="vf-icon" onClick={closeSearch} aria-label="Закрыть поиск">
          <X size={18} />
        </button>
      </div>
    </nav>
  );
}
