// Shared model list for the LDraw viewer.
// LDraw.org CC BY 2.0 Parts Library.

export interface ModelEntry {
    name: string;
    file: string;
}

export const MODEL_LIST: readonly ModelEntry[] = [
    { name: 'Car', file: 'models/car.ldr_Packed.mpd' },
    { name: 'Lunar Vehicle', file: 'models/1621-1-LunarMPVVehicle.mpd_Packed.mpd' },
    { name: 'Radar Truck', file: 'models/889-1-RadarTruck.mpd_Packed.mpd' },
    { name: 'Trailer', file: 'models/4838-1-MiniVehicles.mpd_Packed.mpd' },
    { name: 'Bulldozer', file: 'models/4915-1-MiniConstruction.mpd_Packed.mpd' },
    { name: 'Helicopter', file: 'models/4918-1-MiniFlyers.mpd_Packed.mpd' },
    { name: 'Plane', file: 'models/5935-1-IslandHopper.mpd_Packed.mpd' },
    { name: 'Lighthouse', file: 'models/30023-1-Lighthouse.ldr_Packed.mpd' },
    { name: 'X-Wing mini', file: 'models/30051-1-X-wingFighter-Mini.mpd_Packed.mpd' },
    { name: 'AT-ST mini', file: 'models/30054-1-AT-ST-Mini.mpd_Packed.mpd' },
    { name: 'AT-AT mini', file: 'models/4489-1-AT-AT-Mini.mpd_Packed.mpd' },
    { name: 'Shuttle', file: 'models/4494-1-Imperial Shuttle-Mini.mpd_Packed.mpd' },
    { name: 'TIE Interceptor', file: 'models/6965-1-TIEIntercep_4h4MXk5.mpd_Packed.mpd' },
    { name: 'Star fighter', file: 'models/6966-1-JediStarfighter-Mini.mpd_Packed.mpd' },
    { name: 'X-Wing', file: 'models/7140-1-X-wingFighter.mpd_Packed.mpd' },
    { name: 'AT-ST', file: 'models/10174-1-ImperialAT-ST-UCS.mpd_Packed.mpd' },
] as const;

export const DEFAULT_MODEL_INDEX = 0; // Car
