import type { MacroSnapshot, MacroView } from "./types";

/** Deterministic macro regime engine. No model, key, or external AI request. */
export function generateMacroView(snapshot: MacroSnapshot): MacroView {
  const avgChange = snapshot.indices.length
    ? snapshot.indices.reduce((sum, item) => sum + item.changePercent, 0) / snapshot.indices.length
    : 0;
  const bull: string[] = [];
  const bear: string[] = [];
  const watch: string[] = [];
  const vix = snapshot.vix?.value;

  if (avgChange >= 0) bull.push(`Major indices average ${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(2)}%`);
  else bear.push(`Major indices average ${avgChange.toFixed(2)}%`);
  if (vix != null && vix < 18) bull.push(`VIX at ${vix.toFixed(1)} supports risk appetite`);
  if (vix != null && vix > 25) bear.push(`VIX at ${vix.toFixed(1)} signals elevated stress`);
  if (snapshot.policyPath.bias === "Dovish") bull.push(`Rates structure implies a dovish policy bias`);
  if (snapshot.policyPath.bias === "Hawkish") bear.push(`Rates structure implies a hawkish policy bias`);
  if (snapshot.curveShape === "Steep") bull.push(`2s10s curve is steep at ${snapshot.yieldCurve2s10s?.toFixed(2)}`);
  if (snapshot.curveShape === "Inverted") bear.push(`2s10s curve is inverted at ${snapshot.yieldCurve2s10s?.toFixed(2)}`);
  if (snapshot.dxy && snapshot.dxy.changePercent < -0.3) bull.push(`DXY weakened ${snapshot.dxy.changePercent.toFixed(2)}%`);
  if (snapshot.dxy && snapshot.dxy.changePercent > 0.3) bear.push(`DXY strengthened +${snapshot.dxy.changePercent.toFixed(2)}%`);
  if (snapshot.fearGreed?.score != null && snapshot.fearGreed.score < 25) bull.push(`Fear & Greed at ${snapshot.fearGreed.score}: contrarian support`);
  if (snapshot.fearGreed?.score != null && snapshot.fearGreed.score > 75) bear.push(`Fear & Greed at ${snapshot.fearGreed.score}: complacency risk`);
  if (["Broad", "Healthy"].includes(snapshot.breadth.assessment ?? "")) bull.push(`Breadth is ${snapshot.breadth.assessment?.toLowerCase()} (${snapshot.breadth.source})`);
  if (["Narrow", "Very Narrow"].includes(snapshot.breadth.assessment ?? "")) bear.push(`Breadth is ${snapshot.breadth.assessment?.toLowerCase()} (${snapshot.breadth.source})`);

  while (bull.length < 3) bull.push("Cross-asset confirmation remains a potential upside catalyst");
  while (bear.length < 3) bear.push("Incomplete input coverage remains a source of regime uncertainty");
  if (snapshot.treasury10Y) watch.push(`10Y yield at ${snapshot.treasury10Y.value.toFixed(2)}%`);
  if (vix != null) watch.push(`VIX ${vix.toFixed(1)}; 25 is the next stress threshold`);
  watch.push(`Policy bias remains ${snapshot.policyPath.bias.toLowerCase()}`);

  let regime: MacroView["regime"] = "Mixed";
  if (avgChange > 0.5 && (vix == null || vix < 22) && snapshot.policyPath.bias !== "Hawkish") regime = "Risk-On";
  else if (avgChange < -0.5 || (vix != null && vix > 28)) regime = "Risk-Off";
  else if (avgChange < 0 || (vix != null && vix > 22) || snapshot.policyPath.bias === "Hawkish") regime = "Cautious";

  const objective = [
    `equity momentum ${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(2)}%`,
    vix != null ? `VIX ${vix.toFixed(1)}` : null,
    snapshot.curveShape ? `${snapshot.curveShape.toLowerCase()} yield curve` : null,
    `${snapshot.policyPath.bias.toLowerCase()} policy bias`,
  ].filter(Boolean).join(", ");

  return {
    bullPoints: bull.slice(0, 5), bearPoints: bear.slice(0, 5), watchItems: watch.slice(0, 3), regime,
    neutralSummary: `Rule engine detects ${objective}. Classification is based only on the displayed market inputs.`,
    confidence: snapshot.confidence, generatedAt: new Date().toISOString(), source: "rules",
    dataSources: [...snapshot.availableInputs, "Deterministic rule engine"], snapshot,
  };
}
