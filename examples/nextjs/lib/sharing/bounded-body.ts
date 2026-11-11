export async function boundedJson(request: Request, limit:number) {
  if (Number(request.headers.get("content-length")) > limit) return new Response(null,{status:413});
  const reader = request.body?.getReader();
  if (!reader) return new Response(null,{status:400});
  const decoder = new TextDecoder("utf-8",{fatal:true});
  const parts: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) { await reader.cancel(); return new Response(null,{status:413}); }
      parts.push(decoder.decode(chunk.value,{stream:true}));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(""));
  } catch { return new Response(null,{status:400}); }
  finally { reader.releaseLock(); }
}
