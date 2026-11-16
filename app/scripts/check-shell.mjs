import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
const child=spawn(resolve('src-tauri/target/debug/ffr-analyzer.exe'),[],{windowsHide:true,env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9223'}});
try {
 let browser;
 for(let n=0;n<25;n++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9223');break;}catch{await new Promise(r=>setTimeout(r,500));}}
 if(!browser)throw new Error('WebView2 did not expose its UI');
 const page=browser.contexts()[0].pages()[0];
 await page.getByRole('heading',{name:'Make sense of every measurement.'}).waitFor();
 console.log('Native WebView2 window loaded the FFR Analyzer Start screen.');
 await browser.close();
} finally {child.kill();}
