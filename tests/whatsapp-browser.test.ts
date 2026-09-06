import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppMessage, shareWhatsAppMessage } from '../lib/whatsapp.ts';

void test('browser share flow zachová Unicode až do URL otevřené v novém okně',()=>{
  const opened:string[]=[];
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{open:(url:string)=>opened.push(url)}});
  try{
    const message=buildWhatsAppMessage({from:'07.09.2026 06:00',to:'14.09.2026 06:00',commander:'Bradáč Martin',driver:'Hél Milan',firefighters:['Petržel Martin','ěščřžýáíé'],dt:['Bradáč Martin'],replacements:[{originalName:'Petržel Martin',replacementName:'Hél Milan',from:'08.09.2026 06:00',to:'09.09.2026 06:00'}],obligations:{dt:[{name:'Petržel Martin',due:null,overdue:false}],drivers:[{name:'Hél Milan'}],monthLabel:'září 2026'}});
    const result=shareWhatsAppMessage(message);
    assert.equal(result.ok,true);
    assert.equal(opened.length,1);
    assert.equal(new URL(opened[0]).searchParams.get('text'),message);
    assert.equal(message.includes(String.fromCodePoint(0xfffd)),false);
    for(const sequence of [String.fromCodePoint(0x1f692),String.fromCodePoint(0x1f4c5),String.fromCodePoint(0x1f468,0x200d,0x1f692),String.fromCodePoint(0x1fac1),String.fromCodePoint(0x2705),String.fromCodePoint(0x1f504),String.fromCodePoint(0x26a0,0xfe0f)])assert.ok(message.includes(sequence));
  }finally{
    if(previous)Object.defineProperty(globalThis,'window',previous);else delete (globalThis as {window?:unknown}).window;
  }
});

void test('browser neotevře WhatsApp, pokud zpráva obsahuje náhradní znak',()=>{
  const opened:string[]=[];
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{open:(url:string)=>opened.push(url)}});
  try{const result=shareWhatsAppMessage(`poškozeno ${String.fromCodePoint(0xfffd)}`);assert.equal(result.ok,false);assert.equal(opened.length,0);}finally{if(previous)Object.defineProperty(globalThis,'window',previous);else delete (globalThis as {window?:unknown}).window;}
});
