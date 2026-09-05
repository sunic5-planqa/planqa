import { describe, expect, it } from 'vitest'
import type { ReferenceFile } from '../state/types'
import { findReferenceDocumentId } from './referenceDocumentLink'

const REFERENCE_FILES: ReferenceFile[] = [
  { id: 'confluence-page-005', name: 'NxEF 반품/교환 정책서', content: '...' },
  { id: 'confluence-page-002', name: 'NxEF 홈화면 PRD', content: '...' },
]

describe('findReferenceDocumentId', () => {
  it('finds the confluence page id whose title matches the bracketed prefix', () => {
    const relatedLocation = '[NxEF 반품/교환 정책서] 2-1. 단순 변심 반품'

    expect(findReferenceDocumentId(relatedLocation, REFERENCE_FILES)).toBe('confluence-page-005')
  })

  it('returns null for a same-document related_location (no bracket)', () => {
    expect(findReferenceDocumentId('요구사항 > 결제', REFERENCE_FILES)).toBeNull()
  })

  it('returns null when the bracketed title matches no selected reference file', () => {
    const relatedLocation = '[알 수 없는 문서] 1. 개요'

    expect(findReferenceDocumentId(relatedLocation, REFERENCE_FILES)).toBeNull()
  })
})
