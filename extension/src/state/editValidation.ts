import type { IssueResponse } from '../api/types'

const SIMILARITY_THRESHOLD = 0.3

function levenshteinDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)

  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = temp
    }
  }

  return dp[b.length]
}

export function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLen
}

export interface EditValidation {
  similarityToSuggestion: number
  matchesSuggestionClosely: boolean
  issueLikelyResolved: boolean
}

export function validateEdit(issue: Pick<IssueResponse, 'input_text' | 'suggestion'>, editedText: string): EditValidation {
  const similarityToSuggestion = similarityRatio(issue.suggestion, editedText)
  const issueLikelyResolved = issue.input_text.trim() === '' || !editedText.includes(issue.input_text)

  return {
    similarityToSuggestion,
    matchesSuggestionClosely: similarityToSuggestion >= SIMILARITY_THRESHOLD,
    issueLikelyResolved,
  }
}
