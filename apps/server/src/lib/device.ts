/**
 * Derives a human-friendly device description from the User-Agent, optionally
 * overridden by a name the client supplies (native shells know the real model).
 */
export interface DeviceInfo {
  name: string;
  platform: "ios" | "android" | "macos" | "windows" | "linux" | "unknown";
  clientType: "web" | "native";
}

export function describeDevice(userAgent: string | undefined, hintName?: string, native = false): DeviceInfo {
  const ua = userAgent ?? "";
  let platform: DeviceInfo["platform"] = "unknown";
  let model = "Device";
  if (/iPhone/.test(ua)) [platform, model] = ["ios", "iPhone"];
  else if (/iPad/.test(ua)) [platform, model] = ["ios", "iPad"];
  else if (/Android/.test(ua)) [platform, model] = ["android", /Mobile/.test(ua) ? "Android phone" : "Android tablet"];
  else if (/Macintosh|Mac OS X/.test(ua)) [platform, model] = ["macos", "Mac"];
  else if (/Windows/.test(ua)) [platform, model] = ["windows", "Windows PC"];
  else if (/Linux|X11/.test(ua)) [platform, model] = ["linux", "Linux PC"];

  let browser = "";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/YaBrowser\//.test(ua)) browser = "Yandex Browser";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  const cleanHint = hintName?.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80);
  const name = cleanHint || (browser && !native ? `${model} · ${browser}` : model);
  return { name, platform, clientType: native ? "native" : "web" };
}
