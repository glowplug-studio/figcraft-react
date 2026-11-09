import {readFile} from "node:fs/promises";
import {test,expect} from "@playwright/test";
import {openTextFixture} from "../fixtures/serve-text-module";
import cases from "../fixtures/native-text-layer-pixels.json" with {type:"json"};

test("text strokes, masks, shadows, clipping and rotated runs match native interior pixels",async ({page})=>{
  await openTextFixture(page,"tests/fixtures/text-raster-browser.ts");
  const png=await readFile(new URL("../fixtures/native-text-layer-pixels.png",import.meta.url));
  const measurements=await page.evaluate(async ({cases,png})=>{
    const url="/editor.js",api:typeof import("../fixtures/text-raster-browser")=await import(url);
    const image=await createImageBitmap(new Blob([Uint8Array.from(png)],{type:"image/png"}));
    const ctx=new OffscreenCanvas(240,144).getContext("2d")!;
    const output=[];
    for (const [row,{title,commands}] of cases.entries()) {
      ctx.drawImage(image,0,row*144,240,144,0,0,240,144);
      const a=ctx.getImageData(0,0,240,144).data,b=await api.rasterTextScene(commands);
      let ink=0,interiors=0,totalError=0,interiorError=0;
      for (let i=0;i<a.length;i+=4) {
        const channels=[0,1,2];
        if (channels.every(c=>a[i+c]===a[c] && b[i+c]===a[c])) continue;
        const delta=Math.max(...channels.map(c=>Math.abs(a[i+c]-b[i+c])));
        ink++;totalError+=delta;
        if (i>=960 && i<a.length-960 && [-960,-4,4,960].every(step=>channels.every(c=>a[i+step+c]===a[i+c]))) {
          interiors++;interiorError=Math.max(interiorError,delta);
        }
      }
      output.push({title,ink,interiors,interiorError,mean:totalError/ink});
    }
    image.close();return output;
  },{cases,png:[...png]});
  await test.info().attach("native-text-pixel-comparison",{body:JSON.stringify(measurements),contentType:"application/json"});
  for (const row of measurements) {
    expect(row.ink,row.title).toBeGreaterThan(100);
    expect(row.interiors,row.title).toBeGreaterThan(0);
    expect(row.interiorError,row.title).toBeLessThanOrEqual(1);
    // The rasterisers use different antialiasing. Bound the mean over drawn pixels in the 8-bit image.
    expect(row.mean,row.title).toBeLessThan(9);
  }
});
