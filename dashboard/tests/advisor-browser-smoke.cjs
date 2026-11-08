"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const dashboard=path.resolve(__dirname,"..");
const origin=fs.readFileSync(path.join(dashboard,"index.html"),"utf8");
const tmp=path.join(dashboard,".advisor-browser-smoke-"+process.pid+".html");
const injected="<script>\n(() => {\n  function done(success,reason) {\n    const marker=document.createElement(\"output\");\n    marker.id=\"advisor-browser-smoke-result\";\n    marker.dataset.verdict=success?\"PASS\":\"FAIL\";\n    marker.textContent=reason;\n    document.body.append(marker);\n  }\n  async function run() {\n    const fallback=document.getElementById(\"advisor-external\");\n    const view=document.querySelector('section[data-view=\"advisor\"]');\n    const input=document.getElementById(\"chat-input\");\n    const copy=document.getElementById(\"chat-copy\");\n    const send=document.getElementById(\"chat-send\");\n    const suggestion=document.querySelector(\"#suggest button\");\n    if(!fallback||!view||!input||!copy||!send||!suggestion) return done(false,\"missing-controls\");\n    if(fallback.hidden||view.hidden||!send.disabled) return done(false,\"unexpected-visibility-or-send\");\n    suggestion.click();\n    if(!input.value.trim()) return done(false,\"suggestion-did-not-populate\");\n    const sample=\"NON_PRIVATE_FREE_BROWSER_TEST_2026\";\n    input.value=sample;\n    let copied=\"\";\n    Object.defineProperty(navigator,\"clipboard\",{configurable:true,value:{\n      writeText:async function(value){copied=value}\n    }});\n    copy.click();\n    await Promise.resolve();\n    await new Promise(resolve=>setTimeout(resolve,40));\n    const toast=document.getElementById(\"toast\");\n    if(copied!==sample) return done(false,\"clipboard-did-not-receive-exact-question\");\n    if(!toast||toast.hidden||!toast.textContent.includes(\"تم نسخ السؤال فقط\")) return done(false,\"missing-copy-success-toast\");\n    if(!send.disabled) return done(false,\"send-must-remain-disabled-without-ai-api\");\n    done(true,\"fallback-visible; suggestion-filled; copied-only-test-question; success-toast; send-disabled\");\n  }\n  window.addEventListener(\"load\",()=>setTimeout(()=>run().catch(e=>done(false,String(e))),400),{once:true});\n})();\n</script>";
const chrome=process.env.CHROME||["google-chrome","chromium","chromium-browser"].find(c=>{
  try{execFileSync("which",[c],{stdio:"ignore"});return true}catch{return false}
});
assert.ok(chrome,"Chrome or Chromium missing");
try{
  fs.writeFileSync(tmp,origin+injected,"utf8");
  const url="file://"+tmp+"#advisor";
  const result=execFileSync(chrome,[
    "--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
    "--disable-background-networking","--disable-extensions","--no-first-run",
    "--virtual-time-budget=9000","--dump-dom",url
  ],{timeout:60000,encoding:"utf8",maxBuffer:12*1024*1024,stdio:["ignore","pipe","ignore"]});
  const mark=result.match(/<output id="advisor-browser-smoke-result" data-verdict="(PASS|FAIL)">([^<]*)<\/output>/);
  assert.ok(mark,"Browser test did not finish (no DOM result marker)");
  assert.equal(mark[1],"PASS",mark[2]);
  console.log("PASS: "+mark[2]);
}finally{
  try{fs.unlinkSync(tmp)}catch{}
}