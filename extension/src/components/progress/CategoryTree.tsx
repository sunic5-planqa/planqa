import { useState } from 'react'
import type { ProgressCategory } from '../../api/types'

const STATUS_ICON = { done: '✓', in_progress: '●', pending: '○' } as const

export function CategoryTree({ categories }: { categories: ProgressCategory[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const started = categories.filter((c) => c.items.some((item) => item.status !== 'pending'))
    return new Set(started.map((c) => c.key))
  })

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="category-tree">
      {categories.map((category) => (
        <div key={category.key} className="category-group">
          <button type="button" className="category-group-toggle" onClick={() => toggle(category.key)}>
            {expanded.has(category.key) ? '▼' : '▶'} {category.label}
          </button>
          {expanded.has(category.key) && (
            <ul className="category-item-list">
              {category.items.map((item) => (
                <li key={item.key} className={`category-item category-item-${item.status}`}>
                  <span className="category-item-icon">{STATUS_ICON[item.status]}</span>
                  {item.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
