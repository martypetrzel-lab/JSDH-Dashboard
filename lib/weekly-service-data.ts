export type DashboardService={id:string;status:'DRAFT'|'CONFIRMED';from:string;to:string;crew:{memberId:string;role:'Velitel'|'Strojník'|'Hasič';roleKey:'COMMANDER'|'DRIVER'|'FIREFIGHTER';slot:number;name:string;tag:string;dt:boolean}[]};

export function serializeWeeklyService(service:{id:string;status:string;weekStart:Date;weekEnd:Date;assignments:{memberId:string;role:string;slot:number;nameSnapshot:string;dtSnapshot:boolean}[]}):DashboardService{
  return{id:service.id,status:service.status==='CONFIRMED'?'CONFIRMED':'DRAFT',from:service.weekStart.toISOString(),to:service.weekEnd.toISOString(),crew:service.assignments.map(assignment=>({memberId:assignment.memberId,role:assignment.role==='COMMANDER'?'Velitel':assignment.role==='DRIVER'?'Strojník':'Hasič',roleKey:assignment.role as 'COMMANDER'|'DRIVER'|'FIREFIGHTER',slot:assignment.slot,name:assignment.nameSnapshot,tag:assignment.role==='COMMANDER'?'VD':assignment.role==='DRIVER'?'ST':'H',dt:assignment.dtSnapshot}))};
}
