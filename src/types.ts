export type Phase = "Cut" | "Maintain" | "Gain";
export type RangeKey = "7D" | "30D" | "3M" | "6M" | "1Y" | "ALL";

export interface WeightEntry {
  id: number;
  date: string;
  weight: number;
  phase: Phase | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  id: number;
  current_phase: Phase;
  current_phase_started_on: string;
  updated_at: string;
}

export interface AppData {
  entries: WeightEntry[];
  settings: Settings;
  authenticated: boolean;
}

export interface ChartPoint {
  date: string;
  label: string;
  weight: number | null;
  sevenDayAvg: number | null;
  phase: Phase | null;
  notes: string | null;
}
