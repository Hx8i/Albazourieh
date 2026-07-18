'use client';

import * as React from 'react';
import { Dictionary } from '@/lib/i18n/dictionaries';
import {
  URGENT_NEEDS,
  UrgentNeed,
} from '@/lib/schemas/displaced.schema';

// ─────────────────────────── Needs bar chart ──────────────────────────

interface NeedsBarChartProps {
  dict: Dictionary;
  /** Households per urgent need (absent needs are rendered as 0). */
  needs: Record<UrgentNeed, number>;
}

export function NeedsBarChart({
  dict,
  needs,
}: NeedsBarChartProps): React.JSX.Element {
  const t = dict.displaced;
  const max = Math.max(...URGENT_NEEDS.map((need) => needs[need] ?? 0));

  if (max === 0) {
    return <ChartEmpty text={t.dashboard.charts.empty} />;
  }

  return (
    <div className="space-y-3">
      {URGENT_NEEDS.map((need) => {
        const value = needs[need] ?? 0;
        const width = max > 0 ? (value / max) * 100 : 0;
        return (
          <div
            key={need}
            className="grid grid-cols-[7rem_1fr] items-center gap-3"
            title={`${t.needs[need]}: ${value}`}
          >
            <span className="truncate text-sm text-muted-foreground">
              {t.needs[need]}
            </span>
            {/* Hairline baseline; bars grow from it with a rounded data-end. */}
            <div className="flex items-center gap-2 border-s border-border">
              <div
                className="h-5 max-w-full rounded-e-[4px] bg-primary"
                style={{ width: `${width}%` }}
                aria-hidden
              />
              <span className="text-sm font-semibold tabular-nums">
                {value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChartEmpty({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      {text}
    </div>
  );
}
