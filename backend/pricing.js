// Tracking du cout par appel OpenRouter.
// OpenRouter renvoie le cout exact dans `usage.cost` quand on envoie
// `"usage": {"include": true}` dans la payload.

export function extractUsage(apiResponse) {
  const usage = apiResponse?.usage || {};
  return {
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
    cost_usd: usage.cost ?? null,   // null si non fourni par OpenRouter
  };
}

export function aggregateUsage(usages) {
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let costComplete = true;

  for (const u of usages) {
    if (!u) continue;
    totalPrompt += u.prompt_tokens || 0;
    totalCompletion += u.completion_tokens || 0;
    totalTokens += u.total_tokens || 0;
    if (u.cost_usd == null) {
      costComplete = false;
    } else {
      totalCost += u.cost_usd;
    }
  }

  return {
    total_prompt_tokens: totalPrompt,
    total_completion_tokens: totalCompletion,
    total_tokens: totalTokens,
    total_cost_usd: costComplete ? Number(totalCost.toFixed(6)) : null,
    cost_estimate_complete: costComplete,
  };
}
