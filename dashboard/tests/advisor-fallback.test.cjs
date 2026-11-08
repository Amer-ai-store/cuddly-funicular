"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/);
test("existing dashboard inline JavaScript compiles",()=>{assert.ok(script);assert.doesNotThrow(()=>new vm.Script(script[1]))});
test("chat on static site displays honest AI off state and manual fallback",()=>{
 for(const id of ['id="advisor-off"','id="advisor-external"','id="chat-copy"','id="chat-send"'])assert.ok(html.includes(id),id);
 assert.match(html,/المحادثة التلقائية غير متاحة على GitHub Pages/);
 assert.match(html,/هذا بديل يدوي، وليس اتصال API/);
 assert.match(html,/https:\/\/chatgpt\.com\//);
});
test("fallback needs user click and copies only authored question",()=>{
 assert.match(html,/navigator\.clipboard\.writeText\(question\)/);
 assert.match(html,/S\(input\.value, 4000\)\.trim\(\)/);
 assert.doesNotMatch(html,/navigator\.clipboard\.writeText\(contextSummary/);
 assert.match(html,/\$\("advisor-external"\)\.hidden = false/);
 assert.match(html,/\$\("advisor-external"\)\.hidden = true/);
 assert.match(html,/if \(!sample\) \{ \$\("chat-input"\)\.value = prompt/);
});
