import type { StyleSpecification } from 'maplibre-gl';
import { DamageSeverity } from '@/lib/schemas/damage-report.schema';

/**
 * Free, token-less street basemap (CARTO Voyager via MapLibre) — a
 * bright, labelled "normal" map for the dashboard, no Mapbox key needed.
 */
export const STREET_MAP_STYLE =
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

/** Softer light style for the citizen-facing pin picker. */
export const LIGHT_MAP_STYLE =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/**
 * Token-less satellite basemap: Esri World Imagery raster tiles wrapped
 * in a minimal MapLibre style. Lets staff see actual rooftops/streets
 * when assessing damage clusters, again without any API key.
 */
export const SATELLITE_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [
    {
      id: 'esri-world-imagery',
      type: 'raster',
      source: 'esri-world-imagery',
    },
  ],
};

/** Selectable basemaps for the dashboard damage map. */
export type BasemapMode = 'street' | 'satellite';

/**
 * Al Bazourieh (البازورية), Tyre District, South Lebanon — the town
 * centre itself (the previous value sat ~2 km south of the village).
 */
export const BAZOURIEH_CENTER = {
  latitude: 33.255071802498364,
  longitude: 35.27274335029038,
} as const;

export const DASHBOARD_INITIAL_VIEW = {
  latitude: BAZOURIEH_CENTER.latitude,
  longitude: BAZOURIEH_CENTER.longitude,
  zoom: 13.6,
  pitch: 0,
  bearing: 0,
} as const;

/** RGBA — high-contrast red / orange / yellow, per severity. */
export const SEVERITY_COLORS: Record<DamageSeverity, [number, number, number, number]> = {
  TOTAL: [239, 68, 68, 230],
  PARTIAL: [249, 115, 22, 220],
  MINOR: [250, 204, 21, 210],
};

export const SEVERITY_HEX: Record<DamageSeverity, string> = {
  TOTAL: '#ef4444',
  PARTIAL: '#f97316',
  MINOR: '#facc15',
};
