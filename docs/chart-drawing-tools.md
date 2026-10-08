# Chart drawing tool contract

The drawing API is model-provider neutral. A local analysis process can write
JSON commands while the stock page is open; the UI detects changes within
three seconds and renders them over the active candle interval.

## Discover the schema

```http
GET /api/stock/AAPL/drawings?schema=1
```

## List drawings

```http
GET /api/stock/AAPL/drawings?interval=1d
```

## Upsert drawings

`POST` merges by stable `id`. Send either `drawing` or `drawings`.

```http
POST /api/stock/AAPL/drawings?interval=1d
Content-Type: application/json

{
  "drawings": [
    {
      "id": "support",
      "kind": "trendline",
      "points": [
        { "date": "2026-01-05", "price": 184.25 },
        { "date": "2026-03-12", "price": 198.10 }
      ],
      "extendRight": true,
      "label": "Rising support",
      "style": { "color": "#22c55e", "width": 2, "dash": "6 3" }
    },
    {
      "id": "resistance",
      "kind": "horizontal",
      "points": [{ "date": "2026-03-12", "price": 225 }],
      "label": "Resistance",
      "style": { "color": "#ef4444", "width": 1.5 }
    },
    {
      "id": "target-zone",
      "kind": "rectangle",
      "points": [
        { "date": "2026-04-01", "price": 230 },
        { "date": "2026-05-01", "price": 238 }
      ],
      "label": "Target zone",
      "style": { "color": "#f59e0b", "fill": "#f59e0b", "fillOpacity": 0.12 }
    }
  ]
}
```

## Replace or clear

```http
PUT /api/stock/AAPL/drawings?interval=1d
Content-Type: application/json

{ "drawings": [] }
```

```http
DELETE /api/stock/AAPL/drawings?interval=1d&id=support
DELETE /api/stock/AAPL/drawings?interval=1d&all=1
```

## Primitives

| `kind` | Points | Meaning |
|---|---:|---|
| `trendline` | 2 | Segment; supports `extendLeft` / `extendRight` |
| `ray` | 2 | Starts at point 1 and continues through point 2 |
| `horizontal` | 1 | Full-width price level |
| `vertical` | 1 | Full-height time marker |
| `channel` | 3 | Main line P1→P2 plus parallel line through P3 |
| `rectangle` | 2 | Time/price zone |
| `arrow` | 2 | Directional annotation |
| `polyline` | 2–50 | Multi-point path for patterns and wave counts |
| `label` | 1 | Text annotation with an anchor dot |

Dates that do not exactly match a candle are snapped to the nearest visible
candle. Drawings are stored independently for each `SYMBOL:INTERVAL` in the
local SQLite database. The server validates point counts, numeric prices,
styles, IDs, and a maximum of 100 drawings per layer.
