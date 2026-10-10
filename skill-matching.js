export function normalizeSkill(skill) {
  return String(skill || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function skillMatchScore(requiredSkill, employeeSkills) {
  const required = normalizeSkill(requiredSkill);
  if (!required || !employeeSkills.length) return 0;

  const normalizedSkills = employeeSkills.map(normalizeSkill).filter(Boolean);
  if (normalizedSkills.includes(required)) return 100;
  if (normalizedSkills.some((skill) => skill.includes(required) || required.includes(skill))) return 85;

  const requiredWords = new Set(required.split(" ").filter((word) => word.length > 2));
  if (!requiredWords.size) return 0;

  return Math.max(0, ...normalizedSkills.map((skill) => {
    const employeeWords = new Set(skill.split(" ").filter((word) => word.length > 2));
    const sharedWords = [...requiredWords].filter((word) => employeeWords.has(word)).length;
    return Math.round((sharedWords / requiredWords.size) * 70);
  }));
}
