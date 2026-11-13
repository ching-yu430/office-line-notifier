export const PASSWORD_ITERATIONS:number;
export function passwordRecord(password:string,pepper:string,salt?:string):string;
export function passwordRepairSql(username:string,password:string,pepper:string):string;
