'use client';

import * as React from 'react';
import Map, {
  MapLayerMouseEvent,
  Marker,
  MarkerDragEvent,
} from 'react-map-gl/maplibre';
import { MapPin } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BAZOURIEH_CENTER, LIGHT_MAP_STYLE } from './map-config';

interface LocationPickerMapProps {
  latitude: number | null;
  longitude: number | null;
  onPick: (latitude: number, longitude: number) => void;
}

/**
 * Manual pin-drop fallback for displaced citizens who are not standing
 * at their property: drag the pin (or tap anywhere) to mark the exact
 * location. Fully keyboard/touch friendly via MapLibre's built-ins.
 */
export function LocationPickerMap({
  latitude,
  longitude,
  onPick,
}: LocationPickerMapProps): React.JSX.Element {
  const pinLatitude = latitude ?? BAZOURIEH_CENTER.latitude;
  const pinLongitude = longitude ?? BAZOURIEH_CENTER.longitude;

  const handleMapClick = (event: MapLayerMouseEvent): void => {
    onPick(event.lngLat.lat, event.lngLat.lng);
  };

  const handleDragEnd = (event: MarkerDragEvent): void => {
    onPick(event.lngLat.lat, event.lngLat.lng);
  };

  return (
    <div className="h-72 w-full overflow-hidden rounded-xl border">
      <Map
        initialViewState={{
          latitude: pinLatitude,
          longitude: pinLongitude,
          zoom: 14,
        }}
        mapStyle={LIGHT_MAP_STYLE}
        onClick={handleMapClick}
        attributionControl={false}
        style={{ width: '100%', height: '100%' }}
      >
        <Marker
          latitude={pinLatitude}
          longitude={pinLongitude}
          draggable
          onDragEnd={handleDragEnd}
          anchor="bottom"
        >
          <MapPin
            className="h-10 w-10 fill-red-500 text-red-700 drop-shadow-md"
            aria-hidden
          />
        </Marker>
      </Map>
    </div>
  );
}
