import { useEffect, useRef, useState } from 'react'

interface Props {
  paths: string[]
  onBrowse(): void
  onOpen(path: string): void
  onForget(path: string): Promise<void>
}

export function RecentVaultMenu({ paths, onBrowse, onOpen, onForget }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="recent-vault-control" ref={root}>
    <div className="vault-open-split">
      <button className="button-primary" onClick={onBrowse}>Open a vault</button>
      <button className="button-primary recent-vault-trigger" ref={trigger} aria-label="Show recent vaults"
        aria-expanded={open} aria-controls="recent-vaults" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </div>
    {open && <section id="recent-vaults" className="recent-vault-menu" aria-label="Recent vaults">
      <p className="recent-vault-label">Recent vaults</p>
      {paths.map(path => {
        const parts = path.replaceAll('\\', '/').split('/')
        const name = parts.pop() || path
        const folder = path.slice(0, path.length - name.length).replace(/([\\/])$/, '')
        return <div className="recent-vault-row" key={path}>
          <button className="recent-vault-open" title={path} onClick={() => { setOpen(false); onOpen(path) }}>
            <svg className="recent-vault-file" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v7m10-9 6 6v12a2 2 0 0 1-2 2h-4M14 2v6h6" />
              <rect x="2" y="16" width="8" height="6" rx="1" /><path d="M4 16v-2a2 2 0 0 1 4 0v2" />
            </svg>
            <span className="recent-vault-copy"><strong>{name}</strong><small>{folder}</small></span>
            <svg className="recent-vault-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
          <button className="recent-vault-forget" aria-label={`Remove ${name} from recent`} title="Remove from recent"
            onClick={() => void onForget(path)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
        </div>
      })}
      {!paths.length && <p className="recent-vault-empty">No recent vaults yet.</p>}
    </section>}
  </div>
}
