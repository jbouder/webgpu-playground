import { demos } from '../gpu/registry'

interface SidebarProps {
  activeId: string
  onSelect: (id: string) => void
}

export function Sidebar({ activeId, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">WebGPU Playground</span>
      </div>

      <nav className="sidebar-nav" aria-label="Demos">
        {demos.map((demo, i) => {
          const active = demo.id === activeId
          return (
            <button
              key={demo.id}
              type="button"
              className={`nav-item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(demo.id)}
            >
              <span className="nav-index">{String(i + 1).padStart(2, '0')}</span>
              <span className="nav-text">
                <span className="nav-title">{demo.title}</span>
                <span className="nav-desc">{demo.description}</span>
              </span>
            </button>
          )
        })}
      </nav>

      <footer className="sidebar-foot">
        {demos.length} demo{demos.length === 1 ? '' : 's'}
      </footer>
    </aside>
  )
}
