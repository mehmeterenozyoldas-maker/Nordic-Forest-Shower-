import { Season, WeatherObservation, WeatherStation } from '../types/simulation';

export const NORDIC_WEATHER_STATIONS: WeatherStation[] = [
  { id: 'tromso', name: 'Tromsø', region: 'Arctic Norway · 69.6°N', latitude: 69.6492, longitude: 18.9553 },
  { id: 'abisko', name: 'Abisko', region: 'Swedish Lapland · 68.3°N', latitude: 68.3495, longitude: 18.8312 },
  { id: 'reykjavik', name: 'Reykjavík', region: 'Iceland · 64.1°N', latitude: 64.1466, longitude: -21.9426 },
  { id: 'bergen', name: 'Bergen', region: 'Western Fjords · 60.4°N', latitude: 60.3913, longitude: 5.3221 },
  { id: 'oslo', name: 'Oslo', region: 'Oslofjord · 59.9°N', latitude: 59.9139, longitude: 10.7522 },
];

export interface SolarPosition {
  elevationRad: number;
  azimuthRad: number;
  elevationDeg: number;
}

/**
 * Computes astronomical solar elevation & azimuth for any lat/lon and UTC timestamp.
 */
export function computeSolarPosition(
  latitudeDeg: number,
  longitudeDeg: number,
  date: Date = new Date(),
): SolarPosition {
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86_400_000) + 1;
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // Fractional year in radians
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma);

  const eqTimeMinutes =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const trueSolarMinutes = (utcHours * 60 + eqTimeMinutes + 4 * longitudeDeg + 1440) % 1440;
  const hourAngleDeg = trueSolarMinutes / 4 - 180;
  const hourAngleRad = (hourAngleDeg * Math.PI) / 180;
  const latRad = (latitudeDeg * Math.PI) / 180;

  const sinAlt =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngleRad);
  const clampedSin = Math.max(-1, Math.min(1, sinAlt));
  const elevationRad = Math.asin(clampedSin);
  const elevationDeg = (elevationRad * 180) / Math.PI;

  const cosAz =
    (Math.sin(decl) - Math.sin(latRad) * clampedSin) /
    (Math.cos(latRad) * Math.max(0.01, Math.cos(elevationRad)));
  let azimuthRad = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (hourAngleDeg > 0) azimuthRad = 2 * Math.PI - azimuthRad;

  // Clamp elevation gently so night twilight retains atmospheric aurora illumination
  const simElevation = Math.max(-0.24, Math.min(1.25, elevationRad));

  return {
    elevationRad: simElevation,
    azimuthRad,
    elevationDeg: Number(elevationDeg.toFixed(1)),
  };
}

export function mapWeatherToAtmosphere(
  obs: WeatherObservation,
  solar: SolarPosition,
): {
  season: Season;
  windStrength: number;
  windDirection: number;
  fogDensity: number;
  bloomStrength: number;
  sunElevation: number;
  sunAzimuth: number;
} {
  const isSnowCode =
    (obs.weatherCode >= 71 && obs.weatherCode <= 77) ||
    obs.weatherCode === 85 ||
    obs.weatherCode === 86;

  let season: Season = 'autumn';
  if (isSnowCode || obs.temperatureC <= 1.5) {
    season = 'winter';
  } else if (obs.temperatureC >= 9.0) {
    season = 'spring';
  }

  // Wind: 0..45 km/h maps smoothly to 0.2..4.2 simulation strength
  const windStrength = Math.max(0.15, Math.min(4.2, obs.windSpeedKmh / 11.5));
  const windDirection = ((obs.windDirectionDeg - 180) * Math.PI) / 180;

  // Cloud cover + precipitation drives fog density
  const cloudFactor = obs.cloudCoverPct / 100;
  const precipBoost = Math.min(0.008, obs.precipitationMm * 0.0025);
  const fogDensity = 0.01 + cloudFactor * 0.014 + precipBoost;

  // Twilight/night lifts bloom slightly for aurora visibility
  const nightBoost = solar.elevationRad < 0.05 ? 0.32 : 0.0;
  const bloomStrength = 0.85 + cloudFactor * 0.15 + nightBoost;

  return {
    season,
    windStrength: Number(windStrength.toFixed(2)),
    windDirection: Number(windDirection.toFixed(2)),
    fogDensity: Number(fogDensity.toFixed(4)),
    bloomStrength: Number(bloomStrength.toFixed(2)),
    sunElevation: Number(solar.elevationRad.toFixed(3)),
    sunAzimuth: Number(solar.azimuthRad.toFixed(3)),
  };
}
