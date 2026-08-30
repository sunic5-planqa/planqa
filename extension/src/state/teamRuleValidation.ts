export function isTeamRuleInputValid(input: { rule_name: string; description: string }): boolean {
  return input.rule_name.trim().length > 0 && input.description.trim().length > 0
}
