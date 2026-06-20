import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';

type LatLng = { latitude: number; longitude: number };

export type MapPaneProps = {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number } | null;
  routeCoords: LatLng[];
  following?: boolean;
  style?: any;
};

// Native (iOS/Android) map. Uses Apple Maps on iOS in Expo Go — no API key.
// Dark + muted styling to match VOYA's theme; a tilted 3D camera follows the
// driver during navigation.
export default function MapPane({ origin, destination, routeCoords, following, style }: MapPaneProps) {
  const ref = useRef<MapView>(null);

  // Fit the whole route into view when previewing (not actively navigating).
  useEffect(() => {
    if (following) return;
    const pts: LatLng[] = routeCoords.length
      ? routeCoords
      : [
          { latitude: origin.lat, longitude: origin.lon },
          ...(destination ? [{ latitude: destination.lat, longitude: destination.lon }] : []),
        ];
    if (pts.length >= 2) {
      const t = setTimeout(() => {
        ref.current?.fitToCoordinates(pts, {
          edgePadding: { top: 70, right: 60, bottom: 70, left: 60 },
          animated: true,
        });
      }, 350);
      return () => clearTimeout(t);
    }
  }, [routeCoords, destination, following, origin]);

  // During navigation, drive a tilted 3D camera that tracks the driver and
  // rotates to their heading — the classic turn-by-turn feel.
  useEffect(() => {
    if (!following) return;
    let sub: Location.LocationSubscription | undefined;
    (async () => {
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 4, timeInterval: 1500 },
          (pos) => {
            const { latitude, longitude, heading } = pos.coords;
            ref.current?.animateCamera(
              {
                center: { latitude, longitude },
                pitch: 55,
                heading: heading != null && heading >= 0 ? heading : 0,
                zoom: 17,
              },
              { duration: 700 },
            );
          },
        );
      } catch {
        // If watching fails, the map still shows the user via showsUserLocation.
      }
    })();
    return () => {
      try {
        sub?.remove();
      } catch {}
    };
  }, [following]);

  return (
    <MapView
      ref={ref}
      style={style ?? StyleSheet.absoluteFill}
      showsUserLocation
      followsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      userInterfaceStyle="dark"
      mapType="mutedStandard"
      initialRegion={{
        latitude: origin.lat,
        longitude: origin.lon,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      }}
    >
      {routeCoords.length > 1 && (
        <>
          {/* Neon glow under the route, then the bright core */}
          <Polyline
            coordinates={routeCoords}
            strokeColor="rgba(109,99,255,0.30)"
            strokeWidth={14}
            lineCap="round"
            lineJoin="round"
          />
          <Polyline
            coordinates={routeCoords}
            strokeColor="#8B82FF"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        </>
      )}
      {destination && (
        <Marker coordinate={{ latitude: destination.lat, longitude: destination.lon }} pinColor="#5145E5" />
      )}
    </MapView>
  );
}
