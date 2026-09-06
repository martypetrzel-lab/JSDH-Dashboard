export const LOGIN_WINDOW_MS=15*60*1000;
export const LOGIN_MAX_ATTEMPTS=5;

export type LoginAttemptState={attempts:number;windowStart:Date;blockedUntil:Date|null};
export function nextFailedLoginAttempt(attempt:LoginAttemptState|null,now:Date){
  const inWindow=!!attempt&&now.getTime()-attempt.windowStart.getTime()<LOGIN_WINDOW_MS;
  const attempts=inWindow?attempt!.attempts+1:1;
  return{attempts,windowStart:inWindow?attempt!.windowStart:now,blockedUntil:attempts>=LOGIN_MAX_ATTEMPTS?new Date(now.getTime()+LOGIN_WINDOW_MS):null};
}

export const isLoginBlocked=(attempt:Pick<LoginAttemptState,'blockedUntil'>|null,now:Date)=>!!attempt?.blockedUntil&&attempt.blockedUntil>now;
