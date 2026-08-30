import { chromium } from "playwright-core";
import fs from "node:fs";
const OUT="/tmp/claude-0/-home-user-moon/53649faa-f418-540c-8fd4-f4f76c5e6c34/scratchpad";
const br=await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
for (const [file, tag, h] of [["Main.dc.html","dirA",1200],["DirectionB.dc.html","dirB",900],["DirectionC.dc.html","dirC",1650]]) {
  // the artboards are static, so a plain unwrap is a faithful preview
  let s = fs.readFileSync(file, "utf8");
  const helmet = s.match(/<helmet>([\s\S]*?)<\/helmet>/)[1];
  const body = s.split("</helmet>")[1].split("</x-dc>")[0];
  fs.writeFileSync(`/tmp/${tag}.html`, `<!doctype html><html><head><meta charset="utf-8">${helmet}</head><body>${body}</body></html>`);
  const p = await (await br.newContext({viewport:{width:1440,height:h},deviceScaleFactor:1})).newPage();
  await p.goto(`file:///tmp/${tag}.html`);
  await p.waitForTimeout(2500);
  const box = await p.evaluate(() => { const d=document.body.firstElementChild; const r=d.getBoundingClientRect(); return {w:r.width,h:r.height}; });
  console.log(tag, "content height", Math.round(box.h), "frame", h, box.h > h ? "→ CLIPS" : "ok");
  await p.screenshot({path:`${OUT}/${tag}.png`, fullPage:true});
  await p.close();
}
await br.close();
