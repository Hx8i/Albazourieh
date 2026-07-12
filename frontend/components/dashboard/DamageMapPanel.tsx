'use client';

import * as React from 'react';
import Link from 'next/link';
import DeckGL from '@deck.gl/react';
import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import Map, {
  Layer,
  type LayerProps,
  type MapRef,
  Source,
} from 'react-map-gl/maplibre';
import { ExternalLink, Layers, Map as MapIcon, Milestone, X } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ADMIN_PATH } from '@/lib/constants';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { SpatialPoint } from '@/lib/schemas/damage-report.schema';
import {
  BasemapMode,
  BAZOURIEH_BOUNDARY,
  BOUNDARY_LINE_STYLES,
  DASHBOARD_INITIAL_VIEW,
  enhanceRoadLabels,
  LIGHT_MAP_STYLE,
  readFeatureName,
  type RoadLayerIds,
  SATELLITE_MAP_STYLE,
  SEVERITY_COLORS,
  SEVERITY_HEX,
} from '@/components/map/map-config';

interface DamageMapPanelProps {
  dict: Dictionary;
  locale: Locale;
  points: SpatialPoint[];
  loading: boolean;
}

interface SelectedPoint {
  point: SpatialPoint;
  x: number;
  y: number;
  /** Nearest labelled road under the marker, resolved from the vector tiles. */
  street: string | null;
}

const EMPTY_ROAD_LAYERS: RoadLayerIds = { labelLayerIds: [], lineLayerIds: [] };

/** Minimal escaping for map-sourced text injected into the tooltip's innerHTML. */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);

type Severity = SpatialPoint['severity'];
type MarkerKind = 'property' | 'vehicle';

/**
 * Authentic Lucide line glyphs (24×24, stroke-based). `house` for property
 * reports, `car` for آلية reports — the thin-line silhouettes the prompt
 * asked for, drawn in white inside the target disc.
 */
const GLYPHS: Record<MarkerKind, string> = {
  property:
    '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>' +
    '<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  vehicle:
    '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>' +
    '<circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
};

/**
 * Composite "polished target" marker: a solid severity-coloured disc with a
 * crisp white rim, and the white thin-line glyph on top. A faint dark copy
 * of the glyph sits underneath so the white lines stay legible even on the
 * lighter MINOR yellow. Rendered with `mask: false` so the disc keeps its
 * colour and the glyph stays white (deck.gl does not tint it).
 */
const markerIconUrl = (kind: MarkerKind, hex: string): string => {
  const glyph = GLYPHS[kind];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="96" height="96">` +
    `<circle cx="24" cy="24" r="15" fill="${hex}"/>` +
    `<circle cx="24" cy="24" r="15" fill="none" stroke="#ffffff" stroke-opacity="0.92" stroke-width="1.5"/>` +
    `<g transform="translate(24 24) scale(0.8) translate(-12 -12)" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="#0f172a" stroke-opacity="0.35" stroke-width="2.6">${glyph}</g>` +
    `<g stroke="#ffffff" stroke-width="1.8">${glyph}</g>` +
    `</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

/** deck.gl icon descriptor for one report marker. */
interface MarkerIcon {
  url: string;
  id: string;
  width: number;
  height: number;
  mask: boolean;
}

const SEVERITIES: readonly Severity[] = ['TOTAL', 'PARTIAL', 'MINOR'];
const MARKER_KINDS: readonly MarkerKind[] = ['property', 'vehicle'];

/** Precomputed 6-entry atlas (kind × severity) — stable icon identities. */
const MARKER_ICONS: Record<string, MarkerIcon> = {};
for (const kind of MARKER_KINDS) {
  for (const severity of SEVERITIES) {
    MARKER_ICONS[`${kind}-${severity}`] = {
      url: markerIconUrl(kind, SEVERITY_HEX[severity]),
      id: `${kind}-${severity}`,
      width: 96,
      height: 96,
      mask: false,
    };
  }
};

const VEHICLE_PROPERTY_TYPES: ReadonlySet<string> = new Set([
  'VEHICLE',
  'CAR',
  'MOTORCYCLE',
]);

const markerIconFor = (point: SpatialPoint): MarkerIcon => {
  const kind: MarkerKind = VEHICLE_PROPERTY_TYPES.has(point.propertyType)
    ? 'vehicle'
    : 'property';
  return MARKER_ICONS[`${kind}-${point.severity}`];
};

/** Marker glyph size in pixels, by severity (TOTAL reads largest). */
const iconSize = (severity: Severity): number =>
  severity === 'TOTAL' ? 38 : 30;

/** Base radius (px) of the soft outer glow ring, by severity. */
const glowRadius = (severity: Severity): number =>
  severity === 'TOTAL' ? 12 : severity === 'PARTIAL' ? 14 : 13;

/**
 * deck.gl IconLayer of composite "polished target" markers (severity-coloured
 * disc + white thin-line Lucide glyph) over a soft ScatterplotLayer glow ring
 * — TOTAL rings breathe via a throttled pulse. Drawn on a CARTO Positron
 * basemap whose road/street/place labels are boosted at load so Al Bazourieh's
 * streets stay readable (or a token-less Esri satellite layer), with the
 * municipality geofence overlaid. Hovering shows a tooltip with the nearest
 * road name (read from the vector tiles); clicking opens a popover with that
 * street and a link to the full case file.
 */
export function DamageMapPanel({
  dict,
  locale,
  points,
  loading,
}: DamageMapPanelProps): React.JSX.Element {
  const t = dict.dashboard;
  const [selected, setSelected] = React.useState<SelectedPoint | null>(null);
  const [basemap, setBasemap] = React.useState<BasemapMode>('street');

  const mapRef = React.useRef<MapRef | null>(null);
  const roadLayersRef = React.useRef<RoadLayerIds>(EMPTY_ROAD_LAYERS);

  // Boost the road/street/place labels once a street style has loaded, and
  // cache the vector layer ids used for street-name hit-testing on hover.
  const applyEnhancements = React.useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    roadLayersRef.current = enhanceRoadLabels(map);
  }, []);

  // Re-boost after a basemap swap: the satellite raster carries no labels, and
  // switching back to street rebuilds the vector style from scratch.
  React.useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (basemap !== 'street') {
      roadLayersRef.current = EMPTY_ROAD_LAYERS;
      return;
    }
    map.once('idle', applyEnhancements);
  }, [basemap, applyEnhancements]);

  /**
   * Nearest labelled road under a screen pixel, read straight from the CARTO
   * vector tiles (no geocoding). Queries a small box so thin road lines and
   * sparse labels are still catchable near the cursor.
   */
  const lookupStreet = React.useCallback((x: number, y: number): string | null => {
    const map = mapRef.current?.getMap();
    const { labelLayerIds, lineLayerIds } = roadLayersRef.current;
    const layers = [...lineLayerIds, ...labelLayerIds];
    if (!map || layers.length === 0) return null;
    const features = map.queryRenderedFeatures(
      [
        [x - 6, y - 6],
        [x + 6, y + 6],
      ],
      { layers },
    );
    for (const feature of features) {
      const name = readFeatureName(
        feature.properties as Record<string, unknown> | null,
      );
      if (name) return name;
    }
    return null;
  }, []);

  // Points can be re-fetched while a popover is open; drop the selection
  // if its report disappears from the current filter slice.
  React.useEffect(() => {
    setSelected((previous) =>
      previous && points.some((p) => p.id === previous.point.id)
        ? previous
        : null,
    );
  }, [points]);

  // Gentle "breathing" pulse for TOTAL-destruction markers. Runs only while
  // at least one TOTAL point is on-screen, throttled to ~16fps, and cancels
  // on unmount — an attention cue that never churns the canvas when idle.
  const hasTotal = React.useMemo(
    () => points.some((p) => p.severity === 'TOTAL'),
    [points],
  );
  const [pulse, setPulse] = React.useState(0);
  React.useEffect(() => {
    if (!hasTotal) {
      setPulse(0);
      return;
    }
    let frame = 0;
    let last = 0;
    const tick = (now: number): void => {
      if (now - last > 60) {
        setPulse((Math.sin(now / 500) + 1) / 2);
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hasTotal]);

  // Soft outer glow ring under each marker (no fill blob — it sits *behind*
  // the composite target). TOTAL rings breathe: the radius swells and the
  // fill fades as `pulse` rises.
  const glowLayer = React.useMemo(
    () =>
      new ScatterplotLayer<SpatialPoint>({
        id: 'damage-report-glow',
        data: points,
        getPosition: (d: SpatialPoint) => [d.longitude, d.latitude],
        radiusUnits: 'pixels',
        getRadius: (d: SpatialPoint) =>
          d.severity === 'TOTAL'
            ? glowRadius('TOTAL') + pulse * 8
            : glowRadius(d.severity),
        getFillColor: (d: SpatialPoint): [number, number, number, number] => {
          const [r, g, b] = SEVERITY_COLORS[d.severity];
          const alpha = d.severity === 'TOTAL' ? Math.round(150 - pulse * 80) : 90;
          return [r, g, b, alpha];
        },
        stroked: false,
        filled: true,
        pickable: false,
        updateTriggers: { getRadius: pulse, getFillColor: pulse },
      }),
    [points, pulse],
  );

  const iconLayer = React.useMemo(
    () =>
      new IconLayer<SpatialPoint>({
        id: 'damage-report-icons',
        data: points,
        getPosition: (d: SpatialPoint) => [d.longitude, d.latitude],
        // Composite target markers: house glyph for property, car glyph for
        // آلية. The disc colour already encodes severity — no tint needed.
        getIcon: markerIconFor,
        getSize: (d: SpatialPoint) => iconSize(d.severity),
        sizeUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 90],
      }),
    [points],
  );

  // Municipality geofence: adaptive theme per basemap (dark slate on the
  // light street map, translucent cyan over satellite imagery). Only the
  // paint object changes on toggle, so MapLibre diffs the layer in place
  // instead of re-initializing the canvas.
  const boundaryLayer = React.useMemo((): LayerProps => {
    const lineStyle = BOUNDARY_LINE_STYLES[basemap];
    return {
      id: 'bazourieh-boundary-line',
      type: 'line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': lineStyle.color,
        'line-width': lineStyle.width,
        'line-opacity': lineStyle.opacity,
      },
    };
  }, [basemap]);

  const getTooltip = React.useCallback(
    (info: PickingInfo<SpatialPoint>) => {
      if (!info.object) return null;
      const point = info.object;
      const street = lookupStreet(info.x, info.y);
      const streetLine = street
        ? `<div style="margin-top:2px;opacity:.85">${t.map.nearestRoad}: ${escapeHtml(street)}</div>`
        : '';
      return {
        html: `<div style="font-family:inherit">
          <strong>${t.asset[point.propertyType]}</strong> — ${t.severity[point.severity]}<br/>
          ${escapeHtml(point.neighborhood)}
          ${streetLine}
        </div>`,
        style: {
          backgroundColor: '#111827',
          color: '#f9fafb',
          borderRadius: '8px',
          padding: '8px 10px',
          fontSize: '12px',
        },
      };
    },
    [t, lookupStreet],
  );

  const handleClick = React.useCallback(
    (info: PickingInfo<SpatialPoint>) => {
      if (info.object) {
        setSelected({
          point: info.object,
          x: info.x,
          y: info.y,
          street: lookupStreet(info.x, info.y),
        });
      } else {
        setSelected(null);
      }
    },
    [lookupStreet],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">{t.map.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{t.map.subtitle}</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {(
              [
                ['TOTAL', t.map.legendTotal],
                ['PARTIAL', t.map.legendPartial],
                ['MINOR', t.map.legendMinor],
              ] as const
            ).map(([severity, label]) => (
              <span key={severity} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: SEVERITY_HEX[severity] }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative h-[420px] w-full overflow-hidden rounded-xl border bg-muted">
          <DeckGL
            initialViewState={DASHBOARD_INITIAL_VIEW}
            controller
            layers={[glowLayer, iconLayer]}
            getTooltip={getTooltip}
            onClick={handleClick}
            style={{ position: 'absolute', width: '100%', height: '100%' }}
          >
            <Map
              ref={mapRef}
              onLoad={applyEnhancements}
              mapStyle={
                basemap === 'satellite' ? SATELLITE_MAP_STYLE : LIGHT_MAP_STYLE
              }
              attributionControl={false}
              reuseMaps
            >
              {/* Administrative boundary of Al Bazourieh (stub geometry —
                  see BAZOURIEH_BOUNDARY). Declarative Source/Layer children
                  are re-added by react-map-gl after every style swap. */}
              <Source
                id="bazourieh-boundary"
                type="geojson"
                data={BAZOURIEH_BOUNDARY}
              >
                <Layer {...boundaryLayer} />
              </Source>
            </Map>
          </DeckGL>

          {/* Basemap toggle: normal street map ⇄ satellite imagery */}
          <div
            className="absolute end-3 top-3 z-10 inline-flex overflow-hidden rounded-lg border bg-background/95 shadow-sm backdrop-blur"
            role="group"
          >
            {(
              [
                ['street', MapIcon, t.map.basemapStreet],
                ['satellite', Layers, t.map.basemapSatellite],
              ] as const
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setBasemap(mode)}
                aria-pressed={basemap === mode}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  basemap === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {!loading && points.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
              <span className="rounded-full bg-background/90 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur">
                {t.map.empty}
              </span>
            </div>
          ) : null}

          {selected ? (
            <div
              className="absolute z-10 w-64 rounded-xl border bg-background p-4 shadow-xl"
              style={{
                left: Math.min(selected.x, 640),
                top: Math.max(selected.y - 8, 8),
              }}
              dir={locale === 'ar' ? 'rtl' : 'ltr'}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">
                  {t.asset[selected.point.propertyType]}
                </p>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={dict.common.cancel}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                {selected.point.reporterName}
              </p>
              <p className="text-sm text-muted-foreground">
                {selected.point.neighborhood}
              </p>
              {selected.street ? (
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Milestone className="h-3.5 w-3.5 text-muted-foreground" />
                  {selected.street}
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Badge
                  variant={
                    selected.point.severity === 'TOTAL'
                      ? 'destructive'
                      : selected.point.severity === 'PARTIAL'
                        ? 'warning'
                        : 'secondary'
                  }
                >
                  {t.severity[selected.point.severity]}
                </Badge>
                <Badge variant="outline">
                  {t.status[selected.point.status]}
                </Badge>
              </div>
              <Button asChild size="sm" className="mt-3 w-full">
                <Link
                  href={`/${locale}/${ADMIN_PATH}/reports/${selected.point.id}`}
                >
                  {t.map.openCase}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
