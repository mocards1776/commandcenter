/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEATHER_LAT?: string;
  readonly VITE_WEATHER_LON?: string;
  readonly VITE_WEATHER_TZ?: string;
  readonly VITE_WEATHER_LABEL?: string;
  readonly VITE_VISUAL_CROSSING_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
