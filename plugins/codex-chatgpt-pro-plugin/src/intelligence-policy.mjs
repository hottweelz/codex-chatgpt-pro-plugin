export function firstNonBlank(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

export function resolveIntelligencePreference({
  explicitLevel = "",
  environmentDefault = "",
  noDefault = false,
} = {}) {
  const explicit = String(explicitLevel || "").trim();
  if (explicit) return explicit;
  if (noDefault) return "";
  return String(environmentDefault || "").trim();
}

export function resolveModelPreference({ explicitModel = "", environmentModel = "" } = {}) {
  const explicit = String(explicitModel || "").trim();
  if (explicit) return explicit;
  return String(environmentModel || "").trim();
}

export function resolveCallSelection({
  explicitLevel = "",
  environmentLevel = "",
  environmentDefault = "",
  explicitModel = "",
  environmentModel = "",
  noDefault = false,
} = {}) {
  const cliLevel = firstNonBlank(explicitLevel);
  const envLevel = firstNonBlank(environmentLevel);
  const requestedLevel = resolveIntelligencePreference({
    explicitLevel: cliLevel || envLevel,
    environmentDefault,
    noDefault,
  });
  const requestedModel = resolveModelPreference({ explicitModel, environmentModel });
  return {
    requestedLevel,
    requestedModel,
    intelligenceSource: requestedLevel
      ? (cliLevel ? "cli" : (envLevel ? "environment" : "environment-default"))
      : "account-default",
    modelSource: requestedModel
      ? (String(explicitModel || "").trim() ? "cli" : "environment")
      : "account-default",
  };
}
