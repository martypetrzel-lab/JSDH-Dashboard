import { compare } from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';

const constantTimeEqual=(actual:string,expected:string)=>timingSafeEqual(createHash('sha256').update(actual,'utf8').digest(),createHash('sha256').update(expected,'utf8').digest());

export type LoginUser={id:string;username:string;passwordHash:string;active:boolean;isAdmin:boolean};

export async function authenticateWithSources(username:string,password:string,env:{username:string;password:string},findUser:(username:string)=>Promise<LoginUser|null>,verifyHash:(password:string,hash:string)=>Promise<boolean>=compare){
  const envMatch=constantTimeEqual(username,env.username)&&constantTimeEqual(password,env.password);
  if(envMatch)return{username:env.username,userId:null};
  const user=await findUser(username);
  if(!user||!user.active||!user.isAdmin)return null;
  return await verifyHash(password,user.passwordHash)?{username:user.username,userId:user.id}:null;
}
