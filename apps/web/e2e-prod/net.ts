const PROXY = `http://127.0.0.1:${process.env.E2E_PROXY_PORT ?? 4101}`;

/** Makes the network between the browser and the server misbehave at TCP level (see proxy.mjs). */
export async function net(mode: "up" | "down" | "hang", opts: { block?: string; status?: "404" | "reset" | "hang"; only?: string[] } = {}) {
  const q = new URLSearchParams({ mode, block: opts.block ?? "", status: opts.status ?? "404" });
  for (const o of opts.only ?? []) q.append("only", o);
  const res = await fetch(`${PROXY}/__proxy/set?${q}`);
  if (!res.ok) throw new Error("proxy control failed");
}
