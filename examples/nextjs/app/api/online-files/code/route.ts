import { ingressAddress } from "../../../../lib/sharing/ingress-address";
import { onlinePost } from "../../../../lib/supabase/online-post";
import { lookupCode } from "../../../../lib/sharing/code-lookup";

async function readCode(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let count = 0, text = "";
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) return text + decoder.decode();
      count += value.byteLength;
      if (count > 128) { await reader.cancel(); return ""; }
      text += decoder.decode(value, {stream: true});
    }
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  const host = await onlinePost(request, "text/plain");
  if (host instanceof Response) return host;
  const headers = {"Cache-Control": "private, no-store"};
  if (!host.session) return new Response(null, {status: 401, headers});
  try {
    const address = ingressAddress(request.headers, process.env.VERCEL === "1");
    const receipt = await lookupCode(host.writer, address, await readCode(request));
    return Response.json(receipt.body, {status: receipt.status, headers});
  } catch { return Response.json({error: "Code lookup is temporarily unavailable"}, {status: 503, headers}); }
}
