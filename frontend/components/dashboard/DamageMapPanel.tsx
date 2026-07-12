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

/**
 * White silhouette glyphs rendered as data-URL icons. With `mask: true`
 * deck.gl tints the opaque pixels with `getColor`, so one atlas entry per
 * shape covers every severity color.
 */
const svgDataUrl = (paths: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><g fill="white">${paths}</g></svg>`,
  )}`;

/** Building silhouette (houses, shops, apartments, legacy land). */
const BUILDING_ICON_URL = svgDataUrl(
  '<path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v4h3a1 1 0 0 1 1 1v12h-7v-4h-3v4H5Z"/>',
);

/** Vehicle silhouette (آلية — cars, trucks, legacy motorcycles). */
const VEHICLE_ICON_URL = svgDataUrl(
  '<path d="M4.5 17.5a2.25 2.25 0 1 0 4.5 0h6a2.25 2.25 0 1 0 4.5 0h1a1.5 1.5 0 0 0 1.5-1.5v-3a2.5 2.5 0 0 0-2.5-2.5h-.8l-2.1-4.2A2 2 0 0 0 14.8 5H9.2a2 2 0 0 0-1.8 1.3L5.3 10.5h-.8A2.5 2.5 0 0 0 2 13v3a1.5 1.5 0 0 0 1.5 1.5h1Z"/>',
);

const VEHICLE_PROPERTY_TYPES: ReadonlySet<string> = new Set([
  'VEHICLE',
  'CAR',
  'MOTORCYCLE',
]);

/** deck.gl icon descriptor for one report marker. */
interface MarkerIcon {
  url: string;
  id: string;
  width: number;
  height: number;
  mask: boolean;
}

const BUILDING_ICON: MarkerIcon = {
  url: BUILDING_ICON_URL,
  id: 'building',
  width: 48,
  height: 48,
  mask: true,
};

const VEHICLE_ICON: MarkerIcon = {
  url: VEHICLE_ICON_URL,
  id: 'vehicle',
  width: 48,
  height: 48,
  mask: true,
};

/** Marker glyph size in pixels, by severity (TOTAL reads largest). */
const iconSize = (severity: SpatialPoint['severity']): number =>
  severity === 'TOTAL' ? 30 : 24;

/** Translucent hot-spot halo radius in pixels, by severity. */
const hotspotRadius = (severity: SpatialPoint['severity']): number =>
  severity === 'TOTAL' ? 17 : severity === 'PARTIAL' ? 16 : 15;

/**
 * deck.gl IconLayer (category glyphs) stacked over a translucent
 * ScatterplotLayer "hot-spot" halo, drawn on a CARTO Positron basemap whose
 * road/street/place labels are boosted at load so Al Bazourieh's streets stay
 * readable (or a token-less Esri satellite layer). The halos alpha-blend over
 * the base, so road names remain visible beneath the markers. Hovering shows a
 * tooltip with the nearest road name (read from the vector tiles); clicking
 * opens a popover with that street and a link to the full case file.
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

  const hotspotLayer = React.useMemo(
    () =>
      new ScatterplotLayer<SpatialPoint>({
        id: 'damage-report-hotspots',
        data: points,
        getPosition: (d: SpatialPoint) => [d.longitude, d.latitude],
        getRadius: (d: SpatialPoint) => hotspotRadius(d.severity),
        radiusUnits: 'pixels',
        // Soft translucent fill + firmer ring: reads as a "hot-spot" without
        // painting over the street names underneath.
        getFillColor: (d: SpatialPoint): [number, number, number, number] => {
          const [r, g, b] = SEVERITY_COLORS[d.severity];
          return [r, g, b, 55];
        },
        getLineColor: (d: SpatialPoint): [number, number, number, number] => {
          const [r, g, b] = SEVERITY_COLORS[d.severity];
          return [r, g, b, 190];
        },
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        pickable: false,
      }),
    [points],
  );

  const iconLayer = React.useMemo(
    () =>
      new IconLayer<SpatialPoint>({
        id: 'damage-report-icons',
        data: points,
        getPosition: (d: SpatialPoint) => [d.longitude, d.latitude],
        // Category-aware markers: building glyph for property reports,
        // vehicle glyph for "آلية" reports.
        getIcon: (d: SpatialPoint) =>
          VEHICLE_PROPERTY_TYPES.has(d.propertyType)
            ? VEHICLE_ICON
            : BUILDING_ICON,
        // Severity tint: red / orange / yellow over the masked glyph.
        getColor: (d: SpatialPoint) => SEVERITY_COLORS[d.severity],
        getSize: (d: SpatialPoint) => iconSize(d.severity),
        sizeUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 110],
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
            layers={[hotspotLayer, iconLayer]}
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
