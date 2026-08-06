import { beforeEach, describe, expect, it } from 'vitest'
import { hideLoadingOverlay, showLoadingOverlay } from './loadingOverlay'

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('showLoadingOverlay', () => {
  it('injects the overlay element and its stylesheet', () => {
    showLoadingOverlay()

    expect(document.getElementById('sunnic-loading-overlay')).not.toBeNull()
    expect(document.getElementById('sunnic-loading-overlay-style')).not.toBeNull()
  })

  it('does not duplicate the overlay or stylesheet when called twice', () => {
    showLoadingOverlay()
    showLoadingOverlay()

    expect(document.querySelectorAll('#sunnic-loading-overlay')).toHaveLength(1)
    expect(document.querySelectorAll('#sunnic-loading-overlay-style')).toHaveLength(1)
  })
})

describe('hideLoadingOverlay', () => {
  it('removes the overlay element', () => {
    showLoadingOverlay()
    hideLoadingOverlay()

    expect(document.getElementById('sunnic-loading-overlay')).toBeNull()
  })

  it('is a no-op when the overlay was never shown', () => {
    expect(() => hideLoadingOverlay()).not.toThrow()
  })
})
