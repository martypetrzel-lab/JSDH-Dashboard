import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compare } from 'bcryptjs';
import { authenticateWithSources, type LoginUser } from '../lib/auth-credentials.ts';
import { changePasswordSchema, hashPassword, serializeAppUser } from '../lib/app-users.ts';
import { isLoginBlocked, LOGIN_MAX_ATTEMPTS, nextFailedLoginAttempt } from '../lib/login-attempt.ts';

const env={username:'HasiciNehvizdy',password:'nouzove-heslo'};
const noUser=async()=>null;

test('ENV superadmin se stále přihlásí',async()=>assert.deepEqual(await authenticateWithSources(env.username,env.password,env,noUser),{username:env.username,userId:null}));
test('databázový uživatel se správným heslem se přihlásí',async()=>{const user:LoginUser={id:'u1',username:'MartinB',passwordHash:await hashPassword('bezpecne-heslo'),active:true,isAdmin:true};assert.deepEqual(await authenticateWithSources('MartinB','bezpecne-heslo',env,async()=>user),{username:'MartinB',userId:'u1'});});
test('špatné heslo a deaktivovaný účet jsou odmítnuty',async()=>{const hash=await hashPassword('spravne-heslo'),active:LoginUser={id:'u1',username:'MartinB',passwordHash:hash,active:true,isAdmin:true},disabled={...active,active:false};assert.equal(await authenticateWithSources('MartinB','spatne-heslo',env,async()=>active),null);assert.equal(await authenticateWithSources('MartinB','spravne-heslo',env,async()=>disabled),null);});
test('změna hesla vytváří nový funkční hash',async()=>{const input=changePasswordSchema.parse({password:'nove-bezpecne-heslo',passwordConfirm:'nove-bezpecne-heslo'}),passwordHash=await hashPassword(input.password);assert.equal(await compare('nove-bezpecne-heslo',passwordHash),true);assert.equal(await compare('stare-heslo',passwordHash),false);assert.notEqual(passwordHash,input.password);});
test('username je unikátní v Prisma schématu',()=>{const schema=readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');assert.match(schema,/model AppUser[\s\S]*username\s+String\s+@unique/);});
test('heslo ani hash se neposílá klientovi',()=>{const serialized=serializeAppUser({id:'u1',username:'MartinB',displayName:'Martin Bradáč',active:true,isAdmin:true,lastLoginAt:null,createdAt:new Date(0),updatedAt:new Date(0),passwordHash:'tajny-hash'});assert.equal('passwordHash' in serialized,false);assert.equal('password' in serialized,false);});
test('brute force ochrana zablokuje pátý pokus a po okně začne znovu',()=>{const now=new Date('2026-09-06T12:00:00Z');let state=null;for(let index=0;index<LOGIN_MAX_ATTEMPTS;index+=1)state=nextFailedLoginAttempt(state,now);assert.equal(isLoginBlocked(state,now),true);const later=new Date(now.getTime()+16*60*1000),reset=nextFailedLoginAttempt(state,later);assert.equal(reset.attempts,1);assert.equal(reset.blockedUntil,null);});
