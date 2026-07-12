import {
  getRTLTextPluginStatus,
  setRTLTextPlugin,
  type Map as MaplibreMap,
  type StyleSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { DamageSeverity } from '@/lib/schemas/damage-report.schema';

/**
 * MapLibre doesn't shape/reorder Arabic or Hebrew glyphs out of the box —
 * without this plugin, RTL place labels (village/town names on the CARTO
 * basemap) render as disconnected, reversed-order characters. Registering
 * it once (lazily, client-side only) fixes every map using this config.
 */
if (typeof window !== 'undefined' && getRTLTextPluginStatus() === 'unavailable') {
  setRTLTextPlugin(
    'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js',
    true,
  );
}

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
 * Token-less *hybrid* satellite basemap: Esri World Imagery raster tiles
 * with Esri's transportation (roads/streets) and boundaries-and-places
 * (village/town names) reference overlays on top. Citizens and staff see
 * actual rooftops with road context — still no API key required.
 */
export const SATELLITE_MAP_STYLE: StyleSpecification = {
  version: 8,
  // Custom styles carry no glyph endpoint by default, and MapLibre refuses
  // to draw ANY text layer (e.g. the landmark labels) without one. CARTO's
  // token-less font server covers Latin + Arabic ranges.
  glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution:
        'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
    'esri-transportation': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Esri World Transportation',
    },
    'esri-places': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Esri World Boundaries and Places',
    },
  },
  layers: [
    {
      id: 'esri-world-imagery',
      type: 'raster',
      source: 'esri-world-imagery',
    },
    {
      id: 'esri-transportation',
      type: 'raster',
      source: 'esri-transportation',
    },
    {
      id: 'esri-places',
      type: 'raster',
      source: 'esri-places',
    },
  ],
};

/** Selectable basemaps for the dashboard damage map. */
export type BasemapMode = 'street' | 'satellite';

/**
 * Al Bazourieh (البازورية), Tyre District, South Lebanon — the town
 * centre. These coordinates sit on the built-up core of the village;
 * the dashboard and the citizen pin-picker both default here.
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

/**
 * Recognizable local landmarks used by the citizen pin-picker's
 * "jump to a landmark" dropdown — a familiar visual anchor for elderly
 * or displaced users who can't relate to an abstract map.
 *
 * ⚠️ Coordinates are APPROXIMATE offsets around the village core taken
 * from the town centre, not surveyed positions. The municipality should
 * verify/adjust each one (drop a pin in Google Maps and copy the values).
 */
export interface BazouriehLandmark {
  /** Stable id used as the Select item value. */
  id: string;
  nameAr: string;
  nameEn: string;
  latitude: number;
  longitude: number;
}

export const BAZOURIEH_LANDMARKS: readonly BazouriehLandmark[] = [
  {
    id: 'public-square',
    nameAr: 'الساحة العامة',
    nameEn: 'Public square',
    latitude: 33.25432452781236,
    longitude: 35.27071223821271,
  },
  {
    id: 'municipality',
    nameAr: 'بلدية البازورية',
    nameEn: 'Bazourieh municipality',
    latitude: 33.255543807279054,
    longitude: 35.2709806025151,
  },
  {
    id: 'husseiniya',
    nameAr: 'حسينية البلدة',
    nameEn: 'Town husseiniya',
    latitude: 33.25330973670753,
    longitude: 35.27286235992019,
  },
  {
    id: 'public-school',
    nameAr: 'ثانوية البازورية الرسمية',
    nameEn: 'Al Bazourieh Public school',
    latitude: 33.25402162378958,
    longitude: 35.27493509676443,
  },
  {
    id: 'municipal-stadium',
    nameAr: 'الملعب البلدي',
    nameEn: 'Municipal stadium',
    latitude: 33.25368888634211,
    longitude: 35.285419681951815,
  },
  {
    id: 'rwaysi',
    nameAr: 'حي الرويسي',
    nameEn: 'Rwaysi neighbourhood',
    latitude: 33.25751347082281,
    longitude: 35.28419264997433,
  }
];

/** Camera zoom applied after a landmark quick-jump (roof-level context). */
export const LANDMARK_JUMP_ZOOM = 17;

/** GeoJSON properties carried by each landmark feature (for label layers). */
export interface LandmarkProperties {
  id: string;
  nameAr: string;
  nameEn: string;
}

/**
 * The landmark list as a GeoJSON FeatureCollection, ready to feed a
 * MapLibre `geojson` source so landmark names render as real map labels
 * (they scale, collide and reproject with the basemap, unlike DOM markers).
 */
export const LANDMARK_GEOJSON: FeatureCollection<Point, LandmarkProperties> = {
  type: 'FeatureCollection',
  features: BAZOURIEH_LANDMARKS.map(
    (landmark): Feature<Point, LandmarkProperties> => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [landmark.longitude, landmark.latitude],
      },
      properties: {
        id: landmark.id,
        nameAr: landmark.nameAr,
        nameEn: landmark.nameEn,
      },
    }),
  ),
};

/**
 * Bold text stack for landmark labels. This exact fontstack ships in
 * CARTO's own Positron style, so it is guaranteed to resolve on their
 * glyph server — including the Arabic range (verified: /1536-1791.pbf
 * returns 200). Order matters: Montserrat/Open Sans carry Latin weight,
 * Noto Sans fills in Arabic glyphs.
 */
export const MAP_FONT_BOLD: string[] = [
  'Montserrat Medium',
  'Open Sans Bold',
  'Noto Sans Regular',
  'HanWangHeiLight Regular',
  'NanumBarunGothic Regular',
];

/**
 * Administrative boundary of Al Bazourieh as a GeoJSON polygon.
 *
 * ⚠️ STUB GEOMETRY — a hand-drawn perimeter around the built-up area and
 * its landmarks, NOT the official cadastral boundary. Replace the ring
 * below with the municipality's official polygon when available (e.g.
 * exported from OSM relation or the cadastre) — only this constant needs
 * to change.
 */
export const BAZOURIEH_BOUNDARY: Feature<Polygon> = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [35.2615, 33.2635],
        [35.2705, 33.2665],
        [35.2795, 33.2655],
        [35.2875, 33.2615],
        [35.2905, 33.2555],
        [35.2865, 33.2485],
        [35.2775, 33.2445],
        [35.2675, 33.2455],
        [35.2595, 33.2505],
        [35.2575, 33.2575],
        [35.2615, 33.2635],
      ],
    ],
  },
};

/** Line styling for the municipality boundary, per active basemap. */
export interface BoundaryLineStyle {
  color: string;
  width: number;
  opacity: number;
}

/**
 * Adaptive boundary theme: crisp dark slate over the light street map;
 * high-visibility cyan (semi-translucent) over dense satellite imagery.
 */
export const BOUNDARY_LINE_STYLES: Record<BasemapMode, BoundaryLineStyle> = {
  street: { color: '#1e293b', width: 2, opacity: 0.9 },
  satellite: { color: '#06b6d4', width: 2.5, opacity: 0.8 },
};

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

/** Layer-id fragments that flag a road/street layer in the CARTO vector style. */
const ROAD_HINTS = [
  'road',
  'street',
  'motorway',
  'highway',
  'transport',
] as const;

/** Layer-id fragments that flag a settlement/neighbourhood label layer. */
const PLACE_HINTS = [
  'place',
  'settlement',
  'suburb',
  'neighbourhood',
  'neighborhood',
  'village',
  'town',
  'hamlet',
] as const;

const includesAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

/** Vector layer ids gathered while boosting labels; reused for hover lookups. */
export interface RoadLayerIds {
  /** Symbol layers carrying road/street names (sparse, styled labels). */
  labelLayerIds: string[];
  /** Line layers carrying road geometry + names (continuous, better hit-test). */
  lineLayerIds: string[];
}

const EMPTY_ROAD_LAYERS: RoadLayerIds = { labelLayerIds: [], lineLayerIds: [] };

/**
 * CARTO Positron ships intentionally sparse labels. For an administrative
 * damage audit we want Al Bazourieh's street and road names legible at a
 * glance, so on style-load we walk the vector layers and, for every road /
 * street / place *symbol* layer, force it visible, enlarge the text and
 * thicken the halo (so labels stay readable underneath translucent markers).
 * The matching road *line* layers are returned too so the panel can read the
 * street name under the cursor via queryRenderedFeatures — no geocoding,
 * no token, no cost.
 */
export function enhanceRoadLabels(map: MaplibreMap): RoadLayerIds {
  const style = map.getStyle();
  if (!style.layers) return EMPTY_ROAD_LAYERS;

  const ids: RoadLayerIds = { labelLayerIds: [], lineLayerIds: [] };

  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();
    const isRoad = includesAny(id, ROAD_HINTS);
    const isPlace = includesAny(id, PLACE_HINTS);

    if (layer.type === 'symbol' && (isRoad || isPlace)) {
      map.setLayoutProperty(layer.id, 'visibility', 'visible');
      // Halo/size only apply to text symbols; icon-only layers throw — skip.
      try {
        map.setPaintProperty(layer.id, 'text-halo-width', 1.6);
        map.setPaintProperty(layer.id, 'text-halo-color', '#ffffff');
        if (isRoad) {
          map.setLayoutProperty(layer.id, 'text-size', 13);
          map.setLayerZoomRange(layer.id, 11, 24);
          ids.labelLayerIds.push(layer.id);
        }
      } catch {
        /* icon-only symbol layer — nothing to enlarge */
      }
    } else if (layer.type === 'line' && isRoad) {
      ids.lineLayerIds.push(layer.id);
    }
  }

  return ids;
}

/** Property keys OpenMapTiles/CARTO use to carry a feature's display name. */
const NAME_KEYS = [
  'name',
  'name:latin',
  'name_en',
  'name:en',
  'name:ar',
  'name_ar',
] as const;

/**
 * Pull a human-readable road name out of a rendered vector feature's
 * properties, preferring the localname then Latin/English/Arabic variants.
 */
export function readFeatureName(
  properties: Record<string, unknown> | null | undefined,
): string | null {
  if (!properties) return null;
  for (const key of NAME_KEYS) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}
