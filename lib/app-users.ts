import { hash } from 'bcryptjs';
import { z } from 'zod';

export const USER_PASSWORD_MIN_LENGTH=8;
const username=z.string().trim().min(3,'Uživatelské jméno musí mít alespoň 3 znaky.').max(100).regex(/^[\p{L}\p{N}._-]+$/u,'Uživatelské jméno obsahuje nepovolené znaky.');
export const createUserSchema=z.object({username,displayName:z.string().trim().min(1,'Zobrazované jméno je povinné.').max(150),password:z.string().min(USER_PASSWORD_MIN_LENGTH,`Heslo musí mít alespoň ${USER_PASSWORD_MIN_LENGTH} znaků.`).max(500),passwordConfirm:z.string().max(500),isAdmin:z.boolean().default(true)}).refine(value=>value.password===value.passwordConfirm,{message:'Hesla se neshodují.',path:['passwordConfirm']});
export const updateUserSchema=z.object({username,displayName:z.string().trim().min(1).max(150),active:z.boolean(),isAdmin:z.boolean()});
export const changePasswordSchema=z.object({password:z.string().min(USER_PASSWORD_MIN_LENGTH,`Heslo musí mít alespoň ${USER_PASSWORD_MIN_LENGTH} znaků.`).max(500),passwordConfirm:z.string().max(500)}).refine(value=>value.password===value.passwordConfirm,{message:'Hesla se neshodují.',path:['passwordConfirm']});

export const hashPassword=(password:string)=>hash(password,12);

export type AppUserRow={id:string;username:string;displayName:string;active:boolean;isAdmin:boolean;lastLoginAt:string|null;createdAt:string;updatedAt:string};
export function serializeAppUser(user:{id:string;username:string;displayName:string;active:boolean;isAdmin:boolean;lastLoginAt:Date|null;createdAt:Date;updatedAt:Date}):AppUserRow{return{id:user.id,username:user.username,displayName:user.displayName,active:user.active,isAdmin:user.isAdmin,lastLoginAt:user.lastLoginAt?.toISOString()??null,createdAt:user.createdAt.toISOString(),updatedAt:user.updatedAt.toISOString()};}
