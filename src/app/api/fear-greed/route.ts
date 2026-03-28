import { NextResponse } from "next/server";
import https from "https";
import { cache, TTL } from "@/lib/cache";
import type { FearGreedData, FearGreedLabel } from "@/lib/types";

function normalizeLabel(rating: string): FearGreedLabel {
  const r = rating.toLowerCase();
  if (r.includes("extreme") && r.includes("fear")) return "Extreme Fear";
  if (r.includes("fear")) return "Fear";
  if (r.includes("extreme") && r.includes("greed")) return "Extreme Greed";
  if (r.includes("greed")) return "Greed";
  return "Neutral";
}

function httpsGetCNN(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.cnn.com/markets/fear-and-greed",
        Origin: "https://www.cnn.com",
        Accept: "application/json",
      },
      timeout: 10_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error("Bad JSON")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

export async function GET() {
  const cacheKey = "fear-greed";
  const cached = cache.get<FearGreedData>(cacheKey);
  if (cached) return NextResponse.json({ data: cached, error: null });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await httpsGetCNN(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
    )) as any;

    const fg = json?.fear_and_greed;
    if (!fg?.score) throw new Error("Unexpected CNN response shape");

    const score = Math.round(fg.score);
    const data: FearGreedData = {
      score,
      label: normalizeLabel(fg.rating ?? ""),
      vix: Math.round((fg.previous_close ?? fg.score) * 10) / 10,
      vixChange: Math.round((fg.score - (fg.previous_close ?? fg.score)) * 10) / 10,
      spMomentum: Math.round((fg.score - (fg.previous_1_week ?? fg.score)) * 10) / 10,
    };

    cache.set(cacheKey, data, TTL.FEAR_GREED);
    return NextResponse.json({ data, error: null });
  } catch (err) {
    console.error("[fear-greed]", err);
    return NextResponse.json(
      { data: null, error: "Failed to fetch CNN Fear & Greed Index" },
      { status: 500 }
    );
  }
}
