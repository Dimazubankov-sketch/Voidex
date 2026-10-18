/**
 * The 13 alarm sounds of Voidex Clock (from the Voidex Soundlab export in
 * assets/sounds.json, which keeps the full provenance: source, rights,
 * SHA-256, sample rate). They ship with the app and play locally: nothing is
 * fetched from Soundlab at run time. Alert B comes first and is the default.
 */
export interface ClockSound {
  id: string;
  name: string;
  /** Path inside assets/ (the web app maps it to a bundled URL). */
  file: string;
  /** Seconds. */
  duration: number;
  pack: "reference" | "original";
  sha256: string;
  /** 21 peak levels (0..1) for the little waveform of the sound picker. */
  waveform: number[];
}

export const CLOCK_SOUNDS: readonly ClockSound[] = [
  { id: "reference-alert-b", name: "Alert B", file: "audio/reference/alert-b.wav", duration: 3.422, pack: "reference", sha256: "4830408377ee172e366cde8ec9364d990391f780e5fbd9235dfc928911abe10d", waveform: [1.0, 0.971, 0.862, 0.859, 0.335, 0.336, 0.132, 0.132, 0.128, 0.052, 0.052, 0.021, 0.02, 0.008, 0.01, 0.017, 0.016, 0.007, 0.007, 0.003, 0.002] },
  { id: "alarm-alert-c", name: "Alert C", file: "audio/voidex/alarm-alert-c.wav", duration: 3.538, pack: "original", sha256: "fdf0440ae63db2bbd07f3e3854ef4cf6fd31995b51ec7cebfa740f424e8e4549", waveform: [0.939, 1.0, 0.978, 0.277, 0.266, 0.298, 0.315, 0.073, 0.094, 0.107, 0.113, 0.04, 0.034, 0.039, 0.041, 0.017, 0.012, 0.014, 0.015, 0.008, 0.0] },
  { id: "alarm-alert-d", name: "Alert D", file: "audio/voidex/alarm-alert-d.wav", duration: 3.621, pack: "original", sha256: "7961b0c791223c7cb2590ecb7820573490f6af02ec020573693c59205c8f95e8", waveform: [0.96, 1.0, 0.981, 0.895, 0.318, 0.185, 0.296, 0.284, 0.115, 0.067, 0.107, 0.102, 0.041, 0.024, 0.038, 0.037, 0.015, 0.009, 0.014, 0.013, 0.001] },
  { id: "alarm-alert-e", name: "Alert E", file: "audio/voidex/alarm-alert-e.wav", duration: 3.496, pack: "original", sha256: "8eb68e18a45a71a10ba93fc707c4f65a4e17410300f3f406e45c345dc19cbda2", waveform: [0.958, 1.0, 0.967, 0.154, 0.293, 0.184, 0.275, 0.073, 0.105, 0.081, 0.099, 0.042, 0.038, 0.038, 0.036, 0.023, 0.006, 0.014, 0.013, 0.012, 0.001] },
  { id: "alarm-alert-f", name: "Alert F", file: "audio/voidex/alarm-alert-f.wav", duration: 3.68, pack: "original", sha256: "dca12ca5f2bc72511c060c7b89d2706e9e51ba34b38682d83e99e02fa9fbf74c", waveform: [0.996, 1.0, 0.991, 0.994, 0.303, 0.305, 0.271, 0.325, 0.109, 0.11, 0.083, 0.117, 0.039, 0.04, 0.039, 0.042, 0.014, 0.014, 0.015, 0.015, 0.001] },
  { id: "alarm-alert-g", name: "Alert G", file: "audio/voidex/alarm-alert-g.wav", duration: 3.555, pack: "original", sha256: "12938bd0ebf6a88c8be5ad9aee37c3480a6f8214ddae680d41509b348dccdfd6", waveform: [0.958, 0.997, 1.0, 0.385, 0.284, 0.339, 0.336, 0.16, 0.102, 0.122, 0.121, 0.073, 0.037, 0.044, 0.044, 0.034, 0.013, 0.016, 0.016, 0.014, 0.001] },
  { id: "alarm-sonar", name: "Сонар", file: "audio/voidex/alarm-sonar.wav", duration: 4.657, pack: "original", sha256: "d7d90d487a6d9c802b40fe0f38cf6a7df64b8cd6cc6604df370577621605a35a", waveform: [1.0, 0.303, 0.995, 0.942, 0.226, 0.996, 0.814, 0.199, 0.05, 0.067, 0.02, 0.011, 0.016, 0.006, 0.003, 0.004, 0.002, 0.0, 0.001, 0.0, 0.0] },
  { id: "alarm-arcade", name: "Аркадное утро", file: "audio/voidex/alarm-arcade.wav", duration: 3.925, pack: "original", sha256: "e35aaf98845704171feb8c9fb354dbd873a5e4046d7655fcf9c58da0d439aa77", waveform: [0.909, 0.945, 0.954, 0.95, 1.0, 0.327, 0.229, 0.242, 0.222, 0.061, 0.058, 0.061, 0.033, 0.015, 0.014, 0.015, 0.005, 0.004, 0.004, 0.004, 0.0] },
  { id: "alarm-bells", name: "Колокола", file: "audio/voidex/alarm-bells.wav", duration: 4.885, pack: "original", sha256: "40db75e64af0cba2e8cacad3f6d57e9d70b7f199668089e4af9dc813ad0fa44f", waveform: [0.905, 0.444, 0.977, 0.615, 1.0, 0.875, 0.352, 0.186, 0.165, 0.083, 0.049, 0.043, 0.019, 0.012, 0.01, 0.005, 0.003, 0.003, 0.001, 0.0, 0.0] },
  { id: "alarm-drop", name: "Пробуждение капель", file: "audio/voidex/alarm-drop.wav", duration: 4.268, pack: "original", sha256: "b371e8f9ce2686ddabb94183c879cc62079f94066bcca458edc2e68dfad1b03d", waveform: [0.98, 1.0, 0.994, 0.705, 0.979, 0.994, 0.488, 0.24, 0.11, 0.238, 0.045, 0.06, 0.06, 0.025, 0.015, 0.015, 0.011, 0.004, 0.002, 0.004, 0.001] },
  { id: "alarm-marimba", name: "Маримба", file: "audio/voidex/alarm-marimba.wav", duration: 4.475, pack: "original", sha256: "7c1eb32f341f5faee77349e124a632a277c02f353b6d6cca15539e77fa7308e4", waveform: [0.773, 0.91, 0.954, 1.0, 0.945, 0.908, 0.338, 0.168, 0.126, 0.07, 0.047, 0.032, 0.024, 0.017, 0.007, 0.008, 0.004, 0.002, 0.002, 0.001, 0.0] },
  { id: "alarm-rising", name: "Восход", file: "audio/voidex/alarm-rising.wav", duration: 4.428, pack: "original", sha256: "7afc20821ac6162201b4a07f70e7bca8f4a98b9e15a0e8e7fbea9157e460ab0e", waveform: [0.814, 0.896, 0.984, 1.0, 0.988, 0.733, 0.269, 0.2, 0.196, 0.09, 0.045, 0.05, 0.023, 0.011, 0.013, 0.007, 0.003, 0.003, 0.003, 0.001, 0.0] },
  { id: "alarm-moment", name: "Момент", file: "audio/voidex/alarm-moment.wav", duration: 3.15, pack: "original", sha256: "aae95fa661e9303ba902b1ccad873f14be1725e5189432d65ac3cfbc82ef9617", waveform: [0.959, 1.0, 0.755, 0.753, 0.583, 0.366, 0.353, 0.213, 0.214, 0.117, 0.083, 0.056, 0.027, 0.025, 0.007, 0.004, 0.003, 0.002, 0.001, 0.0, 0.0] },
];

export const DEFAULT_SOUND = "reference-alert-b";

/** The wheel tick (UI sound of the drums), separate from the alarm sounds. */
export const WHEEL_TICK_FILE = "audio/ui/wheel-tick.wav";

export function soundById(id: string | undefined | null): ClockSound {
  return CLOCK_SOUNDS.find((s) => s.id === id) ?? CLOCK_SOUNDS[0]!;
}

export const isSoundId = (id: unknown): id is string => typeof id === "string" && CLOCK_SOUNDS.some((s) => s.id === id);

/** Sound search of the picker (case-insensitive, by name). */
export function searchSounds(query: string): ClockSound[] {
  const q = query.trim().toLocaleLowerCase();
  return CLOCK_SOUNDS.filter((s) => !q || s.name.toLocaleLowerCase().includes(q));
}
