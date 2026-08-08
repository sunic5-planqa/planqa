import { useState } from 'react'
import type { ProgressCategory } from '../../api/types'

export function CategoryTree({ categories }: { categories: ProgressCategory[] }) {
  // 아직 시작 안 한 위계도 세부 룰 목록이 처음부터 다 펼쳐져 있길 원함 — 전부 기본 확장.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(categories.map((c) => c.key)))

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
      {categories.map((category) => {
        // 룰북 검증 중인 이 카테고리(위계) 그룹만 진하게 강조 — 이미 끝난 그룹/아직 시작 안 한
        // 그룹은 둘 다 옅게 처리해 지금 어디를 보고 있는지 한눈에 보이게 함(SCREEN 02 실측).
        const isActiveGroup = category.items.some((item) => item.status === 'in_progress')
        return (
          <div key={category.key} className="category-group">
            <button
              type="button"
              className={`category-group-toggle${isActiveGroup ? ' category-group-toggle-active' : ''}`}
              onClick={() => toggle(category.key)}
            >
              {expanded.has(category.key) ? '▼' : '▶'} {category.label}
            </button>
            {expanded.has(category.key) && (
              <ul className="category-item-list">
                {category.items.map((item) => (
                  <li key={item.key} className={`category-item category-item-${item.status}`}>
                    {item.status === 'done' && <span className="category-item-icon">✓</span>}
                    <span className="category-item-label">{item.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
