import { chromium } from "playwright-core";
import fs from "node:fs";
const OUT="/tmp/claude-0/-home-user-moon/53649faa-f418-540c-8fd4-f4f76c5e6c34/scratchpad";
const br=await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
const files = process.argv.slice(2);
for (const file of files) {
  const tag = file.replace(".dc.html","");
  let s = fs.readFileSync(file, "utf8");
  const helmet = s.match(/<helmet>([\s\S]*?)<\/helmet>/)[1];
  const body = s.split("</helmet>")[1].split("</x-dc>")[0];
  fs.writeFileSync(`/tmp/${tag}.html`, `<!doctype html><html><head><meta charset="utf-8">${helmet}</head><body>${body}</body></html>`);
  const p = await (await br.newContext({viewport:{width:1120,height:800}})).newPage();
  await p.goto(`file:///tmp/${tag}.html`);
  await p.waitForTimeout(2200);
  const h = await p.evaluate(() => Math.round(document.body.firstElementChild.getBoundingClientRect().height));
  console.log(tag.padEnd(16), "height", h);
  await p.screenshot({path:`${OUT}/${tag}.png`, fullPage:true});
  await p.close();
}
await br.close();
