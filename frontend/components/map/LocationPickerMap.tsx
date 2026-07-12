"use client";

import * as React from "react";
import Map, {
  Layer,
  type LayerProps,
  MapLayerMouseEvent,
  type MapRef,
  Marker,
  MarkerDragEvent,
  Source,
} from "react-map-gl/maplibre";
import {
  Compass,
  Landmark,
  Layers,
  Map as MapIcon,
  MapPin,
} from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Locale } from "@/lib/i18n/dictionaries";
import {
  BasemapMode,
  BAZOURIEH_CENTER,
  BAZOURIEH_LANDMARKS,
  enhanceRoadLabels,
  LANDMARK_GEOJSON,
  LANDMARK_JUMP_ZOOM,
  LIGHT_MAP_STYLE,
  MAP_FONT_BOLD,
  SATELLITE_MAP_STYLE,
} from "./map-config";

/** UI copy injected by the wizard so the picker stays dictionary-agnostic. */
export interface LocationPickerLabels {
  landmarkLabel: string;
  landmarkPlaceholder: string;
  pinHint: string;
  basemapStreet: string;
  basemapSatellite: string;
  recenter: string;
}

interface LocationPickerMapProps {
  latitude: number | null;
  longitude: number | null;
  onPick: (latitude: number, longitude: number) => void;
  locale: Locale;
  labels: LocationPickerLabels;
}

/** Opening zoom: tight enough that individual streets/rooftops read clearly. */
const PICKER_INITIAL_ZOOM = 15;

/**
 * Small anchor dot under each landmark label — sits between the label text
 * and the exact landmark coordinate on both basemaps.
 */
const LANDMARK_DOT_LAYER: LayerProps = {
  id: "bazourieh-landmark-dots",
  type: "circle",
  paint: {
    "circle-radius": 4,
    "circle-color": "#2563eb",
    "circle-stroke-width": 1.5,
    "circle-stroke-color": "#ffffff",
  },
};

/**
 * Landmark name labels as a native MapLibre symbol layer: they scale,
 * collide and stay glued to their coordinate through zoom/pan, and the
 * thick white halo keeps them readable over satellite imagery. The label
 * language follows the UI locale, falling back to Arabic (every landmark
 * has an Arabic name).
 */
const landmarkLabelLayer = (locale: Locale): LayerProps => ({
  id: "bazourieh-landmark-labels",
  type: "symbol",
  layout: {
    "text-field": [
      "coalesce",
      ["get", locale === "ar" ? "nameAr" : "nameEn"],
      ["get", "nameAr"],
    ],
    "text-font": MAP_FONT_BOLD,
    "text-size": 13,
    "text-offset": [0, 1.5],
    "text-anchor": "top",
  },
  paint: {
    "text-color": "#0f172a",
    "text-halo-color": "#ffffff",
    "text-halo-width": 2,
  },
});

/**
 * Lucide's map-pin glyph tip sits ~2/24 above the icon's bottom edge, so a
 * bottom-anchored 40px marker floats ~3px over the true coordinate. This
 * constant offset (screen px, applied by MapLibre at every zoom/pitch)
 * plants the visible tip exactly on [longitude, latitude].
 */
const PIN_TIP_OFFSET: [number, number] = [0, 3];

/**
 * Manual pin-drop fallback for displaced citizens who are not standing at
 * their property. Built for low map literacy:
 *
 * - Street basemap with boosted road/street-name labels (Arabic/English),
 *   toggleable to hybrid satellite imagery for users who navigate by
 *   rooftops and terrain rather than by map symbology.
 * - A "jump to a landmark" dropdown of well-known local spots (square,
 *   husseiniya, school, junction, stadium) that flies the camera to a
 *   familiar anchor at roof-level zoom.
 * - A pulsing red pin, draggable (or tap anywhere) to set the location.
 */
export function LocationPickerMap({
  latitude,
  longitude,
  onPick,
  locale,
  labels,
}: LocationPickerMapProps): React.JSX.Element {
  const pinLatitude = latitude ?? BAZOURIEH_CENTER.latitude;
  const pinLongitude = longitude ?? BAZOURIEH_CENTER.longitude;

  const mapRef = React.useRef<MapRef | null>(null);
  const [basemap, setBasemap] = React.useState<BasemapMode>("street");
  const [landmarkId, setLandmarkId] = React.useState<string>("");

  // Boost Positron's sparse road/street labels so citizens can actually
  // read street names while hunting for their house.
  const applyEnhancements = React.useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) enhanceRoadLabels(map);
  }, []);

  // Switching satellite → street rebuilds the vector style from scratch,
  // wiping the boosted labels; re-apply once the new style settles.
  React.useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || basemap !== "street") return;
    map.once("idle", applyEnhancements);
  }, [basemap, applyEnhancements]);

  // Follow externally-set coordinates (e.g. a GPS fix captured while this
  // picker is open): if the pin lands outside the current viewport, glide
  // the camera to it. In-map clicks/drags are by definition already in
  // view, so they never trigger a jump.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || latitude === null || longitude === null) return;
    if (!map.getMap().getBounds().contains([longitude, latitude])) {
      map.easeTo({
        center: [longitude, latitude],
        zoom: LANDMARK_JUMP_ZOOM,
        duration: 800,
        essential: true,
      });
    }
  }, [latitude, longitude]);

  const handleMapClick = (event: MapLayerMouseEvent): void => {
    onPick(event.lngLat.lat, event.lngLat.lng);
  };

  const handleDragEnd = (event: MarkerDragEvent): void => {
    onPick(event.lngLat.lat, event.lngLat.lng);
  };

  /** Reset the camera to the town centre at the opening zoom. */
  const handleRecenter = (): void => {
    mapRef.current?.flyTo({
      center: [BAZOURIEH_CENTER.longitude, BAZOURIEH_CENTER.latitude],
      zoom: PICKER_INITIAL_ZOOM,
      bearing: 0,
      pitch: 0,
      duration: 1200,
      essential: true,
    });
  };

  /** Fly the camera to a familiar landmark at roof-level zoom. */
  const handleLandmarkJump = (id: string): void => {
    setLandmarkId(id);
    const landmark = BAZOURIEH_LANDMARKS.find((l) => l.id === id);
    const map = mapRef.current;
    if (!landmark || !map) return;
    map.flyTo({
      center: [landmark.longitude, landmark.latitude],
      zoom: LANDMARK_JUMP_ZOOM,
      duration: 1800,
      essential: true,
    });
  };

  return (
    <div className="space-y-2">
      {/* Landmark quick-jump: a familiar reference point beats raw panning. */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden />
          {labels.landmarkLabel}
        </label>
        <Select value={landmarkId} onValueChange={handleLandmarkJump}>
          <SelectTrigger>
            <SelectValue placeholder={labels.landmarkPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {BAZOURIEH_LANDMARKS.map((landmark) => (
              <SelectItem key={landmark.id} value={landmark.id}>
                {locale === "ar" ? landmark.nameAr : landmark.nameEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="relative h-80 w-full overflow-hidden rounded-xl border">
        <Map
          ref={mapRef}
          initialViewState={{
            latitude: pinLatitude,
            longitude: pinLongitude,
            zoom: PICKER_INITIAL_ZOOM,
          }}
          maxZoom={17}
          mapStyle={
            basemap === "satellite" ? SATELLITE_MAP_STYLE : LIGHT_MAP_STYLE
          }
          onLoad={applyEnhancements}
          onClick={handleMapClick}
          attributionControl={false}
          style={{ width: "100%", height: "100%" }}
        >
          {/* Landmark names as native map labels — declarative Source/Layer
              children survive basemap style swaps (react-map-gl re-adds
              them after each style load) without re-creating the canvas. */}
          <Source
            id="bazourieh-landmarks"
            type="geojson"
            data={LANDMARK_GEOJSON}
          >
            <Layer {...LANDMARK_DOT_LAYER} />
            <Layer {...landmarkLabelLayer(locale)} />
          </Source>

          <Marker
            latitude={pinLatitude}
            longitude={pinLongitude}
            draggable
            onDragEnd={handleDragEnd}
            anchor="bottom"
            offset={PIN_TIP_OFFSET}
          >
            <MapPin
              className="relative h-10 w-10 fill-red-500 text-red-700 drop-shadow-md"
              aria-hidden
            />
          </Marker>
        </Map>

        {/* Basemap toggle: labelled street map ⇄ hybrid satellite imagery */}
        <div
          className="absolute end-2 top-2 z-10 inline-flex overflow-hidden rounded-lg border bg-background/95 shadow-sm backdrop-blur"
          role="group"
        >
          {(
            [
              ["street", MapIcon, labels.basemapStreet],
              ["satellite", Layers, labels.basemapSatellite],
            ] as const
          ).map(([mode, Icon, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBasemap(mode)}
              aria-pressed={basemap === mode}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                basemap === mode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {/* Recenter on the town (also resets bearing/pitch after gestures). */}
        <button
          type="button"
          onClick={handleRecenter}
          aria-label={labels.recenter}
          title={labels.recenter}
          className="absolute bottom-2 end-2 z-10 rounded-lg border bg-background/95 p-2 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
        >
          <Compass className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {labels.pinHint}
      </p>
    </div>
  );
}
