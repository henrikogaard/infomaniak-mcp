#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const siteKey = "6LdcMKgUAAAAAE-v9oXOW9sNCWRiuZga1ayC7a6L";
const action = "homepage";
const recaptchaVersion = 3;

const helperCode = `(async()=>{const siteKey=${JSON.stringify(siteKey)};const action=${JSON.stringify(action)};const recaptchaVersion=${recaptchaVersion};async function ensureRecaptcha(){if(window.grecaptcha?.execute)return window.grecaptcha;await new Promise((resolve,reject)=>{const existing=document.querySelector('script[data-infomaniak-mcp="swisstransfer-recaptcha"]');if(existing){const started=Date.now();const timer=setInterval(()=>{if(window.grecaptcha?.execute){clearInterval(timer);resolve();}else if(Date.now()-started>10000){clearInterval(timer);reject(new Error('Timed out waiting for reCAPTCHA to load.'));}},100);return;}const callback='infomaniakMcpRecaptchaLoaded'+Date.now();window[callback]=()=>{delete window[callback];resolve();};const script=document.createElement('script');script.dataset.infomaniakMcp='swisstransfer-recaptcha';script.src='https://www.google.com/recaptcha/api.js?render='+encodeURIComponent(siteKey)+'&onload='+encodeURIComponent(callback);script.async=true;script.defer=true;script.onerror=()=>reject(new Error('Failed to load reCAPTCHA API.'));document.head.appendChild(script);});if(!window.grecaptcha?.execute)throw new Error('reCAPTCHA API unavailable.');return window.grecaptcha;}const grecaptcha=await ensureRecaptcha();const token=await grecaptcha.execute(siteKey,{action});try{await navigator.clipboard.writeText(token);}catch{}const payload={recaptcha_token:token,recaptcha_version:recaptchaVersion};console.log('SwissTransfer MCP payload:',JSON.stringify(payload,null,2));alert('SwissTransfer token generated. It has been copied to your clipboard if the browser allowed it. Tokens expire quickly.');return payload;})().catch((error)=>{console.error(error);alert('SwissTransfer token helper failed: '+(error?.message??String(error)));});`;

const bookmarklet = `javascript:${helperCode}`;

const args = new Set(process.argv.slice(2));
const wantsBookmarklet = args.has("--bookmarklet");
const wantsConsole = args.has("--console");
const wantsCopy = args.has("--copy");

if (wantsCopy) {
  const target = wantsBookmarklet ? bookmarklet : helperCode;
  const result = spawnSync("pbcopy", { input: `${target}\n` });
  if (result.status === 0) {
    console.log(`Copied ${wantsBookmarklet ? "bookmarklet" : "console snippet"} to clipboard.`);
  } else {
    console.error("Failed to copy to clipboard with pbcopy.");
    process.exitCode = 1;
  }
}

if (!wantsBookmarklet) {
  console.log("SwissTransfer console snippet");
  console.log("Run this in DevTools on https://www.swisstransfer.com/ :");
  console.log("");
  console.log(helperCode);
  console.log("");
}

if (!wantsConsole) {
  console.log("SwissTransfer bookmarklet");
  console.log("Create a bookmark with this URL, open https://www.swisstransfer.com/, then click it:");
  console.log("");
  console.log(bookmarklet);
  console.log("");
}

console.log("Token details");
console.log(`- Site key: ${siteKey}`);
console.log(`- Action: ${action}`);
console.log(`- recaptcha_version: ${recaptchaVersion}`);
console.log("- Tokens are short-lived. Generate one right before calling the MCP tool or live smoke.");
console.log("");
console.log("Examples");
console.log(`- Smoke test: ENABLE_EXPERIMENTAL_SWISSTRANSFER=1 SWISSTRANSFER_RECAPTCHA_TOKEN='<token>' npm run smoke:live`);
console.log(`- MCP args: {"files":[{"name":"example.txt","base64_content":"..."}],"recaptcha_token":"<token>","recaptcha_version":${recaptchaVersion},"expiration_days":1,"download_limit":1}`);
